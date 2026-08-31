import test from 'node:test';
import assert from 'node:assert/strict';
import { isCanonicalInstant } from '../../src/operator-runtime/time.js';
import { validateCounterfactualPrediction } from '../../src/operator-runtime/contracts.js';

function predictionWith(recordedAt) {
  return {
    schema: 'eve-atelier-visual-counterfactual-prediction/v1',
    predictionId: 'counterfactual:prediction:time:001',
    packRef: {
      packId: 'operator-pack:example-core',
      version: '1.0.0',
      digest: 'a'.repeat(64),
    },
    operatorRef: {
      operatorId: 'visual.op.semantic.adjust_axis',
      version: '1.0.0',
    },
    artifactBefore: {
      artifactId: 'artifact:synthetic:before',
      sha256: 'b'.repeat(64),
    },
    intervention: {
      target: { kind: 'art.document', id: 'document:synthetic:001' },
      axisChanges: [
        { axisId: 'semantic.axis.example.intensity', mode: 'SET', value: 0.4 },
      ],
      lockIds: ['semantic.lock.example.identity'],
      minimalClosureOperatorRefs: [{
        operatorId: 'visual.op.semantic.adjust_axis',
        version: '1.0.0',
      }],
    },
    predictedDeltas: [{
      axisId: 'semantic.axis.example.intensity',
      direction: 'DECREASE',
      magnitude: 'SMALL',
    }],
    scopeRefs: ['scope:character-art:synthetic'],
    rationaleRefs: ['rationale:synthetic:001'],
    alternativeRationaleRefs: [],
    evidenceRefs: ['evidence:synthetic:001'],
    evidenceClass: 'MODEL_INFERENCE',
    provenance: { kind: 'AI', id: 'ai:time-test' },
    recordedAt,
  };
}

test('accepts canonical RFC3339 full instants with Z or an explicit offset', () => {
  const valid = [
    '2026-09-01T01:00:00Z',
    '2026-09-01T01:00:00.1Z',
    '2026-09-01T01:00:00.12Z',
    '2026-09-01T01:00:00.123Z',
    '2026-09-01T01:00:00+08:00',
    '2024-02-29T23:59:59-05:30',
  ];
  for (const value of valid) assert.equal(isCanonicalInstant(value), true, value);
});

test('rejects normalized nonexistent dates and implementation-defined date strings', () => {
  const invalid = [
    '2026-02-31T01:00:00+08:00',
    '2025-02-29T01:00:00Z',
    '2026-09-01',
    '2026-09-01 01:00:00Z',
    '2026-09-01T25:00:00Z',
    '2026-09-01T01:00:00+0800',
    '2026-09-01T01:00:00.0001Z',
    'September 1, 2026 01:00:00 GMT',
  ];
  for (const value of invalid) assert.equal(isCanonicalInstant(value), false, value);

  assert.deepEqual(validateCounterfactualPrediction(predictionWith(invalid[0])), {
    ok: false,
    reason: 'counterfactual_prediction_recorded_at_invalid',
  });
});
