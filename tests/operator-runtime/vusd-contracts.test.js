import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCounterfactualObservation,
  validateCounterfactualPrediction,
  validateOperatorProposal,
} from '../../src/operator-runtime/contracts.js';

function packRef() {
  return {
    packId: 'operator-pack:example-core',
    version: '1.0.0',
    digest: 'a'.repeat(64),
  };
}

function operatorRef(operatorId = 'visual.op.semantic.adjust_axis') {
  return { operatorId, version: '1.0.0' };
}

function provenance(kind = 'AI') {
  return { kind, id: `${kind.toLowerCase()}:vusd-test` };
}

function artifact(artifactId, sha = 'b') {
  return { artifactId, sha256: sha.repeat(64) };
}

function delta(axisId, direction, magnitude) {
  return { axisId, direction, magnitude };
}

function validPrediction() {
  return {
    schema: 'eve-atelier-visual-counterfactual-prediction/v1',
    predictionId: 'counterfactual:prediction:001',
    packRef: packRef(),
    operatorRef: operatorRef(),
    artifactBefore: artifact('artifact:synthetic:before'),
    intervention: {
      target: { kind: 'art.document', id: 'document:synthetic:001' },
      axisChanges: [
        { axisId: 'semantic.axis.example.intensity', mode: 'SET', value: 0.4 },
      ],
      lockIds: ['semantic.lock.example.identity'],
      minimalClosureOperatorRefs: [
        operatorRef('visual.op.semantic.adjust_axis'),
      ],
    },
    predictedDeltas: [
      delta('semantic.axis.example.intensity', 'DECREASE', 'MEDIUM'),
      delta('semantic.axis.example.identity', 'STABLE', 'SMALL'),
    ],
    scopeRefs: ['scope:character-art:synthetic'],
    rationaleRefs: ['rationale:synthetic:functional:001'],
    alternativeRationaleRefs: ['rationale:synthetic:alternative:001'],
    evidenceRefs: ['evidence:synthetic:model-inference:001'],
    evidenceClass: 'MODEL_INFERENCE',
    provenance: provenance('AI'),
    recordedAt: '2026-09-01T01:00:00+08:00',
  };
}

function validObservation() {
  return {
    schema: 'eve-atelier-visual-counterfactual-observation/v1',
    observationId: 'counterfactual:observation:001',
    predictionId: 'counterfactual:prediction:001',
    artifactAfter: artifact('artifact:synthetic:after', 'c'),
    observedDeltas: [
      delta('semantic.axis.example.intensity', 'DECREASE', 'SMALL'),
      delta('semantic.axis.example.identity', 'STABLE', 'SMALL'),
    ],
    collateralDeltas: [
      delta('semantic.axis.example.novelty', 'INCREASE', 'SMALL'),
    ],
    evaluationRefs: ['evaluation:synthetic:001'],
    limitationRefs: ['limitation:single-synthetic-sample'],
    evidenceRefs: ['evidence:synthetic:generated-variant:001'],
    evidenceClass: 'GENERATED_VARIANT',
    provenance: provenance('SYSTEM'),
    recordedAt: '2026-09-01T01:05:00+08:00',
  };
}

function validProposal() {
  return {
    schema: 'eve-atelier-operator-proposal/v1',
    proposalId: 'operator-proposal:synthetic:001',
    basePackRef: packRef(),
    proposedOperatorRef: operatorRef('visual.op.semantic.synthetic_relation'),
    decomposition: {
      kind: 'COMPOSITE',
      componentOperatorRefs: [operatorRef('visual.op.semantic.adjust_axis')],
    },
    scopeRefs: ['scope:character-art:synthetic'],
    residualRefs: ['counterfactual:observation:001'],
    rationaleRefs: ['rationale:synthetic:proposal:001'],
    evidenceRefs: ['evidence:synthetic:residual:001'],
    counterevidenceRefs: ['counterevidence:synthetic:001'],
    provenance: provenance('AI'),
    recordedAt: '2026-09-01T01:10:00+08:00',
  };
}

test('validates separately typed prediction, observation, and candidate-only proposal records', () => {
  assert.deepEqual(validateCounterfactualPrediction(validPrediction()), { ok: true });
  assert.deepEqual(validateCounterfactualObservation(validObservation()), { ok: true });
  assert.deepEqual(validateOperatorProposal(validProposal()), { ok: true });
});

test('preserves unknown as a first-class delta without accepting schema or authority leakage', () => {
  const unresolved = validPrediction();
  unresolved.predictedDeltas[0] = delta(
    'semantic.axis.example.intensity',
    'UNKNOWN',
    'UNKNOWN',
  );
  assert.deepEqual(validateCounterfactualPrediction(unresolved), { ok: true });

  const attacks = [
    ['prediction observation leakage', validPrediction(), value => {
      value.observedDeltas = [];
    }, /counterfactual_prediction_field_forbidden:observedDeltas/],
    ['observation prediction leakage', validObservation(), value => {
      value.predictedDeltas = [];
    }, /counterfactual_observation_field_forbidden:predictedDeltas/],
    ['proposal promotion leakage', validProposal(), value => {
      value.status = 'ACTIVE';
    }, /operator_proposal_field_forbidden:status/],
    ['proposal provider leakage', validProposal(), value => {
      value.providerId = 'provider:forbidden';
    }, /operator_proposal_field_forbidden:providerId/],
    ['private path leakage', validObservation(), value => {
      value.limitationRefs = ['C:\\private\\evidence.json'];
    }, /counterfactual_observation_local_path_forbidden/],
  ];

  for (const [name, value, mutate, expected] of attacks) {
    mutate(value);
    const validate = name.startsWith('prediction')
      ? validateCounterfactualPrediction
      : name.startsWith('observation') || name === 'private path leakage'
        ? validateCounterfactualObservation
        : validateOperatorProposal;
    assert.match(validate(value).reason, expected, name);
  }
});

test('rejects stronger evidence classes when the record declares AI provenance', () => {
  const aiControlledClaim = validObservation();
  aiControlledClaim.evidenceClass = 'CONTROLLED_EXPERIMENT';
  aiControlledClaim.provenance = provenance('AI');
  assert.deepEqual(validateCounterfactualObservation(aiControlledClaim), {
    ok: false,
    reason: 'counterfactual_observation_evidence_overclaim:AI',
  });

  const primitive = validProposal();
  primitive.decomposition = {
    kind: 'PRIMITIVE_CANDIDATE',
    componentOperatorRefs: [operatorRef('visual.op.semantic.adjust_axis')],
  };
  assert.deepEqual(validateOperatorProposal(primitive), {
    ok: false,
    reason: 'operator_proposal_primitive_components_forbidden',
  });
});
