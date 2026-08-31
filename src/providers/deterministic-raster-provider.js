import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class SharpRasterProvider {
  async probe() {
    try {
      const mod = await import('sharp');
      const sharp = mod.default ?? mod;
      return { available: true, providerId: 'provider:sharp', versions: sharp.versions ?? {} };
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package 'sharp'/.test(String(error))) {
        return { available: false, reason: 'sharp_not_installed' };
      }
      return { available: false, reason: 'sharp_load_failed', detail: String(error) };
    }
  }
}

export class PillowRasterProvider {
  constructor({ python = 'python3', worker = resolve('providers/python/raster_worker.py') } = {}) {
    this.python = python;
    this.worker = worker;
    this.providerId = 'provider:pillow-reference';
    this.providerVersion = '0.1';
  }

  async probe() {
    const r = spawnSync(this.python, ['-c', 'import PIL,cv2,numpy; print(PIL.__version__)'], { encoding: 'utf8' });
    return r.status === 0
      ? { available: true, providerId: this.providerId, version: r.stdout.trim() }
      : { available: false, reason: 'python_image_runtime_unavailable', detail: r.stderr };
  }

  async execute(request) {
    const r = spawnSync(this.python, [this.worker], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    let payload;
    try { payload = JSON.parse(r.stdout || '{}'); } catch { payload = null; }
    if (r.status !== 0 || !payload?.ok) {
      throw new Error(payload?.error ?? r.stderr ?? 'raster_provider_failed');
    }
    return {
      providerId: this.providerId,
      providerVersion: this.providerVersion,
      operationId: request.operationId,
      packRef: request.packRef === undefined ? undefined : structuredClone(request.packRef),
      operatorRef: request.operatorRef === undefined ? undefined : structuredClone(request.operatorRef),
      operatorId: request.operatorId,
      inputArtifactId: request.inputArtifactId,
      outputArtifactId: request.outputArtifactId,
      output: request.output,
      outputSha256: createHash('sha256').update(readFileSync(request.output)).digest('hex'),
      metadata: payload.metadata,
    };
  }
}
