import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const worker = resolve('providers/python/validation_worker.py');

function invoke(payload) {
  const result = spawnSync('python3', [worker], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  let parsed;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch { parsed = null; }
  if (result.status !== 0 || !parsed?.ok) {
    throw new Error(parsed?.error ?? result.stderr ?? 'validation_failed');
  }
  return parsed.result;
}

export function inspectRaster(path) {
  return invoke({ action: 'inspect', path });
}

export function validateBackgroundRemoval(output) {
  const evidence = inspectRaster(output);
  const accepted = evidence.transparentPixels > 0 && evidence.opaquePixels > 0;
  return {
    verdict: accepted ? 'ACCEPT' : 'REPAIR',
    ...evidence,
  };
}

export function validateRelight(source, output) {
  const evidence = invoke({ action: 'compare_relight', source, output });
  const accepted = evidence.sameDimensions && evidence.sameAlpha && evidence.rgbChanged;
  return {
    verdict: accepted ? 'ACCEPT' : 'REPAIR',
    ...evidence,
  };
}
