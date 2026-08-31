import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ComfyUiProvider } from '../../src/providers/comfyui-provider.js';
import { DiffusersProvider } from '../../src/providers/diffusers-provider.js';
import { PythonCharacterRemasterEvaluator } from '../../src/character-remaster/python-evaluator.js';
import { MrmicClient } from '../../src/mrmic-client.js';
import { sanitizeRealMvpEvidence } from '../../src/character-remaster/evidence.js';

async function safe(operation) {
  try {
    return await operation();
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

function gpuProbe() {
  const result = spawnSync('nvidia-smi', [
    '--query-gpu=name,memory.total,driver_version',
    '--format=csv,noheader,nounits',
  ], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return { available: false, reason: 'nvidia_smi_unavailable' };
  const [name, memoryMiB, driverVersion] = result.stdout.trim().split(',').map(value => value.trim());
  return { available: true, name, memoryMiB: Number(memoryMiB), driverVersion };
}

export async function collectRuntimeProbe({ config = {}, env = process.env } = {}) {
  const comfyui = new ComfyUiProvider({
    baseUrl: env.EVE_COMFYUI_URL ?? config.provider?.baseUrl ?? 'http://127.0.0.1:8188',
    timeoutMs: 2000,
  });
  const diffusers = new DiffusersProvider({
    python: config.python ?? 'python3',
    model: config.provider?.type === 'diffusers' ? config.provider.model : null,
  });
  const evaluator = new PythonCharacterRemasterEvaluator({
    python: config.python ?? 'python3',
    model: config.evaluator?.model ?? null,
  });
  const mrmic = new MrmicClient({
    baseUrl: env.EVE_MRMIC_URL ?? config.mrmic?.baseUrl ?? 'http://127.0.0.1:4173',
    timeoutMs: 2000,
  });
  const [comfyuiResult, diffusersResult, evaluatorResult, mrmicResult] = await Promise.all([
    safe(() => comfyui.probe({ includeObjectInfo: true })),
    safe(() => diffusers.probe()),
    safe(() => evaluator.probe()),
    safe(() => mrmic.probeCapabilities().then(value => ({ available: true, ...value }))),
  ]);
  return sanitizeRealMvpEvidence({
    schema: 'eve-atelier-runtime-probe/v1',
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    gpu: gpuProbe(),
    providers: {
      comfyui: comfyuiResult,
      diffusers: diffusersResult,
    },
    evaluator: evaluatorResult,
    mrmic: mrmicResult,
  });
}

async function main(argv = process.argv.slice(2)) {
  let config = {};
  const configIndex = argv.indexOf('--config');
  if (configIndex >= 0) config = JSON.parse(await readFile(resolve(argv[configIndex + 1]), 'utf8'));
  const outputIndex = argv.indexOf('--output');
  const output = outputIndex >= 0
    ? resolve(argv[outputIndex + 1])
    : resolve('artifacts', 'runtime', 'real-mvp', 'runtime-probe.json');
  const result = await collectRuntimeProbe({ config });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return { output, result };
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  main().then(
    value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`),
    error => {
      process.stderr.write(`error:${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
