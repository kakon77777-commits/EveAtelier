import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { decideCharacterRemasterVerdict } from './evaluation.js';

function subprocessInvoker({ python, worker }) {
  return payload => {
    const result = spawnSync(python, [worker], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    let parsed;
    try {
      parsed = JSON.parse(result.stdout || '{}');
    } catch {
      throw new Error('character_evaluator_protocol_error');
    }
    if (result.status !== 0 || parsed?.ok !== true) {
      throw new Error(parsed?.error ?? result.stderr ?? 'character_evaluator_failed');
    }
    return parsed.result;
  };
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('character_evaluator_protocol_error');
  }
  return value;
}

export class PythonCharacterRemasterEvaluator {
  constructor({
    python = 'python3',
    worker = resolve('providers/python/character_remaster_evaluator.py'),
    model = null,
    invoke,
  } = {}) {
    this.model = model ? structuredClone(model) : null;
    this.invoke = invoke ?? subprocessInvoker({ python, worker });
  }

  async probe() {
    const result = requireObject(this.invoke({ action: 'probe', model: this.model }));
    if (typeof result.available !== 'boolean') throw new Error('character_evaluator_protocol_error');
    return structuredClone(result);
  }

  async evaluate({ sourcePath, candidatePath, references, thresholds }) {
    const evidence = requireObject(this.invoke({
      action: 'evaluate',
      model: this.model,
      sourcePath,
      candidatePath,
      references,
      thresholds,
    }));
    return decideCharacterRemasterVerdict(evidence);
  }

  async buildLocalizedRepairMask({ width, height, regions, featherRadius = 0, outputPath }) {
    return requireObject(this.invoke({
      action: 'build_localized_repair_mask',
      width,
      height,
      regions,
      featherRadius,
      outputPath,
    }));
  }

  async evaluateLocalizedRepair({ parentPath, candidatePath, maskPath }) {
    return requireObject(this.invoke({
      action: 'evaluate_localized_repair',
      parentPath,
      candidatePath,
      maskPath,
    }));
  }
}
