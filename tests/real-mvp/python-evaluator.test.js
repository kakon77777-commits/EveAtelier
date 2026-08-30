import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PythonCharacterRemasterEvaluator } from '../../src/character-remaster/python-evaluator.js';

const passingEvidence = {
  artifact: {
    decoded: true,
    width: 512,
    height: 512,
    bytes: 4096,
    nonEmptyPixels: 250_000,
    sha256: 'b'.repeat(64),
  },
  evaluator: {
    evaluatorId: 'evaluator:clip-hybrid',
    evaluatorVersion: '0.1.0',
    modelId: 'model:vision-local',
    measurement: 'representation_similarity',
  },
  thresholds: {
    thresholdSetId: 'thresholds:test',
    calibrationStatus: 'CALIBRATED',
    calibrationFixtureSet: 'fixture-set:test',
    identityMin: 0.70,
    lineAlignmentMin: 0.60,
    colorAlignmentMin: 0.60,
    styleAlignmentMin: 0.60,
    artifactQualityMin: 0.70,
    negativeReferenceMax: 0.40,
  },
  scores: {
    identity: 0.82,
    lineAlignment: 0.72,
    colorAlignment: 0.71,
    styleAlignment: 0.69,
    artifactQuality: 1,
    negativeReferenceSimilarity: 0.20,
  },
  warnings: [],
};

test('preserves an honest unavailable evaluator probe', async () => {
  const evaluator = new PythonCharacterRemasterEvaluator({
    model: { modelId: 'model:not-cached' },
    invoke: () => ({ available: false, reason: 'model_not_available_locally' }),
  });
  assert.deepEqual(await evaluator.probe(), {
    available: false,
    reason: 'model_not_available_locally',
  });
});

test('rejects a malformed evaluator worker response', async () => {
  const evaluator = new PythonCharacterRemasterEvaluator({ invoke: () => null });
  await assert.rejects(() => evaluator.probe(), /character_evaluator_protocol_error/);
});

test('derives the final verdict from independent evaluator evidence', async () => {
  const evaluator = new PythonCharacterRemasterEvaluator({
    model: { modelId: 'model:vision-local' },
    invoke: payload => {
      assert.equal(payload.action, 'evaluate');
      assert.equal(payload.sourcePath, 'source.png');
      return passingEvidence;
    },
  });
  const result = await evaluator.evaluate({
    sourcePath: 'source.png',
    candidatePath: 'candidate.png',
    references: [],
    thresholds: passingEvidence.thresholds,
  });
  assert.equal(result.verdict, 'ACCEPT');
  assert.deepEqual(result.scores, passingEvidence.scores);
});

test('normalizes tensor and pooled model image-feature outputs', () => {
  const code = [
    'from types import SimpleNamespace',
    'import torch',
    'from providers.python.image_feature_output import normalized_image_features',
    'raw = torch.tensor([[3.0, 4.0], [5.0, 12.0]])',
    'direct = normalized_image_features(raw)',
    'pooled = normalized_image_features(SimpleNamespace(pooler_output=raw))',
    'assert torch.allclose(direct.norm(dim=-1), torch.ones(2))',
    'assert torch.allclose(pooled, direct)',
    "print('normalized')",
  ].join('; ');
  const result = spawnSync('python3', ['-c', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'normalized');
});
