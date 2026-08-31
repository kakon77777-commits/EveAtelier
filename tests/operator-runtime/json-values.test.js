import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../../src/operator-runtime/canonical.js';
import {
  isCanonicalJsonValue,
  isDenseJsonArray,
  isPlainJsonObject,
} from '../../src/operator-runtime/json-values.js';
import { validateCounterfactualPrediction } from '../../src/operator-runtime/contracts.js';

function prediction() {
  return {
    schema: 'eve-atelier-visual-counterfactual-prediction/v1',
    predictionId: 'counterfactual:prediction:json:001',
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
    provenance: { kind: 'AI', id: 'ai:json-test' },
    recordedAt: '2026-09-01T01:00:00+08:00',
  };
}

test('accepts only plain own-property objects and dense ordinary arrays as canonical JSON', () => {
  const nullPrototype = Object.create(null);
  nullPrototype.value = ['safe', 1, true, null];
  assert.equal(isPlainJsonObject({}), true);
  assert.equal(isPlainJsonObject(nullPrototype), true);
  assert.equal(isDenseJsonArray(['safe']), true);
  assert.equal(isCanonicalJsonValue(nullPrototype), true);
  assert.equal(canonicalJson(nullPrototype), '{"value":["safe",1,true,null]}');
});

test('rejects inherited fields, sparse arrays, accessors, symbols, cycles, and non-JSON numbers', () => {
  const inherited = Object.create({ required: 'inherited' });
  const sparse = Array(1);
  const sparseWithValue = [];
  sparseWithValue[1] = 'value';
  const extraArrayProperty = ['value'];
  extraArrayProperty.extra = 'hidden';
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get: () => 'computed',
  });
  const symbolKey = { value: 'safe' };
  symbolKey[Symbol('hidden')] = 'hidden';
  const cyclic = {};
  cyclic.self = cyclic;

  const invalid = [
    inherited,
    sparse,
    sparseWithValue,
    extraArrayProperty,
    accessor,
    symbolKey,
    cyclic,
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: undefined },
  ];
  for (const value of invalid) {
    assert.equal(isCanonicalJsonValue(value), false);
    assert.throws(() => canonicalJson(value), /non_canonical_json_value/);
  }
});

test('VUSD contracts reject values whose validated view would differ from persisted JSON', () => {
  const inheritedIntervention = prediction();
  inheritedIntervention.intervention = Object.create(inheritedIntervention.intervention);
  assert.deepEqual(validateCounterfactualPrediction(inheritedIntervention), {
    ok: false,
    reason: 'counterfactual_prediction_json_value_invalid',
  });

  const sparseScope = prediction();
  sparseScope.scopeRefs = Array(1);
  assert.deepEqual(validateCounterfactualPrediction(sparseScope), {
    ok: false,
    reason: 'counterfactual_prediction_json_value_invalid',
  });
});
