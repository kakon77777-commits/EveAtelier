import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { compileComfyWorkflow } from './comfyui-workflow.js';

export class ComfyUiProvider {
  constructor({
    baseUrl = 'http://127.0.0.1:8188',
    timeoutMs = 1500,
    workflow = null,
    bindings = null,
    outputNodeId = null,
    modelIdentity = null,
    clientId = null,
    pollIntervalMs = 250,
    maxWaitMs = 120_000,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.workflow = workflow ? structuredClone(workflow) : null;
    this.bindings = bindings ? structuredClone(bindings) : null;
    this.outputNodeId = outputNodeId;
    this.modelIdentity = modelIdentity ? structuredClone(modelIdentity) : null;
    this.clientId = clientId;
    this.pollIntervalMs = pollIntervalMs;
    this.maxWaitMs = maxWaitMs;
    this.sleep = sleep;
    this.providerId = 'provider:comfyui-external';
    this.providerVersion = '0.2.0';
  }

  async #response(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`comfyui_http_${response.status}`);
    return response;
  }

  async #json(path, options = {}) {
    return (await this.#response(path, options)).json();
  }

  async probe({ includeObjectInfo = false } = {}) {
    try {
      const info = await this.#json('/system_stats');
      const result = { available: true, providerId: this.providerId, mode: 'external_http', info };
      if (includeObjectInfo) result.objectInfo = await this.#json('/object_info');
      return result;
    } catch (error) {
      return { available: false, reason: 'comfyui_unavailable', detail: String(error) };
    }
  }

  async queueWorkflow({ workflow, clientId }) {
    const body = { prompt: workflow };
    if (clientId) body.client_id = clientId;
    const result = await this.#json('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (typeof result.prompt_id !== 'string') throw new Error('comfyui_missing_prompt_id');
    return {
      executionId: result.prompt_id,
      status: 'running',
      providerId: this.providerId,
      queueNumber: result.number ?? null,
    };
  }

  async #uploadSource(path) {
    const form = new FormData();
    form.append('image', new Blob([await readFile(path)]), basename(path));
    form.append('subfolder', 'eve');
    form.append('overwrite', 'true');
    const result = await this.#json('/upload/image', { method: 'POST', body: form });
    if (typeof result.name !== 'string' || result.name.length === 0) {
      throw new Error('comfyui_upload_result_invalid');
    }
    return {
      name: result.name,
      subfolder: result.subfolder ?? '',
      type: result.type ?? 'input',
      workflowName: result.subfolder ? `${result.subfolder}/${result.name}` : result.name,
    };
  }

  async #waitForHistory(promptId) {
    const deadline = Date.now() + this.maxWaitMs;
    while (Date.now() <= deadline) {
      const payload = await this.#json(`/history/${encodeURIComponent(promptId)}`);
      const record = payload?.[promptId];
      if (record?.status?.status_str === 'error') throw new Error('comfyui_execution_failed');
      if (record?.outputs && Object.keys(record.outputs).length > 0) return record;
      await this.sleep(this.pollIntervalMs);
    }
    const error = new Error('comfyui_execution_uncertain_timeout');
    error.code = 'UNKNOWN_AFTER_DISPATCH';
    throw error;
  }

  #outputImage(history) {
    if (typeof this.outputNodeId !== 'string' || this.outputNodeId.length === 0) {
      throw new Error('comfyui_output_node_required');
    }
    const images = history.outputs?.[this.outputNodeId]?.images;
    if (!Array.isArray(images) || images.length !== 1) throw new Error('comfyui_output_ambiguous');
    const image = images[0];
    if (typeof image.filename !== 'string' || image.filename.length === 0) {
      throw new Error('comfyui_output_invalid');
    }
    return {
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output',
    };
  }

  async generateVariation(request) {
    if (!this.workflow || !this.bindings) throw new Error('comfyui_workflow_configuration_required');
    if (!this.modelIdentity) throw new Error('comfyui_model_identity_required');
    const upload = await this.#uploadSource(request.source.path);
    const maskUpload = request.mask ? await this.#uploadSource(request.mask.path) : null;
    const filenamePrefix = `eve/${request.operationId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
    const compiled = compileComfyWorkflow({
      workflow: this.workflow,
      bindings: this.bindings,
      request: {
        ...request,
        sourceImageName: upload.workflowName,
        maskImageName: maskUpload?.workflowName,
        filenamePrefix,
      },
    });
    const parameterDigest = createHash('sha256').update(JSON.stringify(compiled)).digest('hex');
    const startedAt = new Date().toISOString();
    const queued = await this.queueWorkflow({ workflow: compiled, clientId: this.clientId });
    const history = await this.#waitForHistory(queued.executionId);
    const output = this.#outputImage(history);
    const query = new URLSearchParams(output).toString();
    const bytes = Buffer.from(await (await this.#response(`/view?${query}`)).arrayBuffer());
    await mkdir(dirname(request.outputPath), { recursive: true });
    await writeFile(request.outputPath, bytes);
    return {
      status: 'completed',
      mode: 'real',
      executionId: queued.executionId,
      providerId: this.providerId,
      providerVersion: this.providerVersion,
      modelIdentity: structuredClone(this.modelIdentity),
      outputPath: request.outputPath,
      parameterDigest,
      startedAt,
      finishedAt: new Date().toISOString(),
      evidence: {
        upload,
        ...(maskUpload ? { maskUpload } : {}),
        output,
        queueNumber: queued.queueNumber,
      },
    };
  }
}
