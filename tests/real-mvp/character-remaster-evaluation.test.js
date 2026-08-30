import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCharacterRemasterVerdict } from '../../src/character-remaster/evaluation.js';

const artifact = {
  decoded: true,
  width: 1024,
  height: 1024,
  bytes: 2048,
  nonEmptyPixels: 900_000,
  sha256: 'a'.repeat(64),
};

const evaluator = {
  evaluatorId: 'evaluator:clip-hybrid',
  evaluatorVersion: '0.1.0',
  modelId: 'model:vision-test',
  measurement: 'representation_similarity',
};

const thresholds = {
  thresholdSetId: 'thresholds:calibrated-test',
  calibrationStatus: 'CALIBRATED',
  calibrationFixtureSet: 'fixture-set:test-v1',
  identityMin: 0.78,
  lineAlignmentMin: 0.62,
  colorAlignmentMin: 0.62,
  styleAlignmentMin: 0.62,
  artifactQualityMin: 0.70,
  negativeReferenceMax: 0.40,
};

const scores = {
  identity: 0.82,
  lineAlignment: 0.72,
  colorAlignment: 0.71,
  styleAlignment: 0.68,
  artifactQuality: 0.90,
  negativeReferenceSimilarity: 0.20,
};

function evidence(overrides = {}) {
  return {
    artifact,
    evaluator,
    thresholds,
    scores,
    warnings: [],
    ...overrides,
  };
}

test('keeps uncalibrated evaluation evidence unverified', () => {
  const result = decideCharacterRemasterVerdict(evidence({
    thresholds: { ...thresholds, calibrationStatus: 'EXAMPLE_UNCALIBRATED' },
  }));
  assert.equal(result.verdict, 'UNVERIFIED');
  assert.deepEqual(result.failures, ['thresholds_not_calibrated']);
});

test('rejects a negative-reference violation before positive-score acceptance', () => {
  const result = decideCharacterRemasterVerdict(evidence({
    scores: { ...scores, negativeReferenceSimilarity: 0.82 },
  }));
  assert.equal(result.verdict, 'REJECT');
  assert.deepEqual(result.failures, ['negative_reference_violation']);
});

test('requests repair when a hard identity threshold is missed', () => {
  const result = decideCharacterRemasterVerdict(evidence({
    scores: { ...scores, identity: 0.70 },
  }));
  assert.equal(result.verdict, 'REPAIR');
  assert.deepEqual(result.failures, ['identity_below_threshold']);
});

test('accepts only complete calibrated evidence and preserves warnings', () => {
  assert.equal(decideCharacterRemasterVerdict(evidence()).verdict, 'ACCEPT');
  const warned = decideCharacterRemasterVerdict(evidence({ warnings: ['minor_color_drift'] }));
  assert.equal(warned.verdict, 'ACCEPT_WITH_WARNINGS');
  assert.deepEqual(warned.warnings, ['minor_color_drift']);
});
