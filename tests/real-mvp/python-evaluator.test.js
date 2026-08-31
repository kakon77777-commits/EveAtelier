import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('builds a deterministic normalized mask for localized repair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-localized-mask-'));
  const outputPath = join(directory, 'mask.png');
  const evaluator = new PythonCharacterRemasterEvaluator({ python: 'python3' });

  const result = await evaluator.buildLocalizedRepairMask({
    width: 16,
    height: 16,
    featherRadius: 0,
    regions: [{ kind: 'rectangle', x: 0.25, y: 0.25, width: 0.25, height: 0.25 }],
    outputPath,
  });

  assert.equal(result.width, 16);
  assert.equal(result.height, 16);
  assert.equal(result.nonZeroPixels, 16);
  assert.equal(result.maskCoverage, 0.0625);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('measures pixel changes inside and outside the localized repair mask', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-localized-evaluation-'));
  const parentPath = join(directory, 'parent.png');
  const candidatePath = join(directory, 'candidate.png');
  const maskPath = join(directory, 'mask.png');
  const fixture = spawnSync('python3', ['-c', [
    'from PIL import Image, ImageDraw',
    'import sys',
    "parent=Image.new('RGB',(8,8),(10,20,30))",
    'candidate=parent.copy()',
    'for y in range(2,4):',
    '  for x in range(2,4): candidate.putpixel((x,y),(110,20,30))',
    "mask=Image.new('L',(8,8),0)",
    'ImageDraw.Draw(mask).rectangle((2,2,3,3),fill=255)',
    'parent.save(sys.argv[1])',
    'candidate.save(sys.argv[2])',
    'mask.save(sys.argv[3])',
  ].join('\n'), parentPath, candidatePath, maskPath], { encoding: 'utf8' });
  assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout);

  const evaluator = new PythonCharacterRemasterEvaluator({ python: 'python3' });
  const result = await evaluator.evaluateLocalizedRepair({ parentPath, candidatePath, maskPath });

  assert.equal(result.sameDimensions, true);
  assert.equal(result.totalPixels, 64);
  assert.equal(result.maskPixels, 4);
  assert.equal(result.maskCoverage, 0.0625);
  assert.equal(result.insideChangedPixels, 4);
  assert.equal(result.outsideChangedPixels, 0);
  assert.equal(result.outsideMaxAbsoluteDelta, 0);
  assert.ok(result.insideMeanAbsoluteError > 0);
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

test('groups repeated negative reference features without overwriting them', () => {
  const code = [
    'from providers.python.reference_grouping import group_reference_records',
    "references = [{'role':'line_reference','path':'line.png'}, {'role':'negative_reference','path':'negative-a.png'}, {'role':'negative_reference','path':'negative-b.png'}]",
    "groups = group_reference_records(references, ['line-feature', 'negative-a-feature', 'negative-b-feature'])",
    "assert [item['path'] for item in groups['negative_reference']] == ['negative-a.png', 'negative-b.png']",
    "assert [item['feature'] for item in groups['negative_reference']] == ['negative-a-feature', 'negative-b-feature']",
    "print('grouped')",
  ].join('; ');
  const result = spawnSync('python3', ['-c', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'grouped');
});
