import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function workerInvoker({ python, worker, fixture }) {
  return payload => {
    const args = [worker];
    if (fixture) args.push('--fixture');
    const result = spawnSync(python, args, {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    let parsed;
    try {
      parsed = JSON.parse(result.stdout || '{}');
    } catch {
      parsed = null;
    }
    if (result.status !== 0 || parsed?.ok !== true) {
      throw new Error(parsed?.error ?? result.stderr ?? 'diffusers_worker_failed');
    }
    return parsed.result;
  };
}

export class DiffusersProvider {
  constructor({
    python = 'python3',
    worker = resolve('providers/python/diffusers_worker.py'),
    fixture = false,
    model = null,
    invoke,
  } = {}) {
    this.fixture = fixture;
    this.model = model ? structuredClone(model) : null;
    this.invoke = invoke ?? workerInvoker({ python, worker, fixture });
    this.providerId = 'provider:diffusers-python';
    this.providerVersion = '0.2.0';
  }

  async probe() {
    return this.invoke({ action: 'probe', model: this.model });
  }

  async generate({ prompt, output, width = 64, height = 64, seed = 0 }) {
    const result = this.invoke({ action: 'generate', prompt, output, width, height, seed });
    if (result.status !== 'completed') throw new Error(result.reason ?? 'diffusers_unavailable');
    return {
      providerId: this.providerId,
      providerVersion: '0.1',
      operatorId: 'visual.op.generative.generate',
      status: 'completed',
      ...result,
    };
  }

  async generateVariation(request) {
    if (!this.fixture && (!this.model || typeof this.model.modelId !== 'string' || !this.model.modelId)) {
      throw new Error('explicit_model_required');
    }
    const model = this.fixture
      ? { modelId: 'fixture:deterministic-raster', revision: '0.1', allowDownload: false }
      : this.model;
    const payload = {
      action: 'generate_variation',
      sourcePath: request.source.path,
      outputPath: request.outputPath,
      prompt: request.intentText.join('\n'),
      negativePrompt: request.negativePrompt ?? '',
      width: model.width ?? null,
      height: model.height ?? null,
      seed: request.seed,
      strength: model.strength ?? 0.45,
      guidanceScale: model.guidanceScale ?? 7.0,
      inferenceSteps: model.inferenceSteps ?? 30,
      model,
    };
    const result = this.invoke(payload);
    if (result.status !== 'completed') throw new Error(result.reason ?? 'diffusers_unavailable');
    const parameterDigest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return {
      status: 'completed',
      mode: result.mode ?? (this.fixture ? 'fixture' : 'real'),
      executionId: result.executionId ?? `diffusers:${request.operationId}`,
      providerId: this.providerId,
      providerVersion: this.providerVersion,
      modelIdentity: result.modelIdentity ?? {
        id: model.modelId,
        revision: model.revision ?? 'unspecified',
      },
      outputPath: result.outputPath ?? result.output,
      parameterDigest,
      evidence: structuredClone(result.evidence ?? {}),
    };
  }
}
