import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperatorRegistryStore } from '../../src/operator-runtime/registry-store.js';
import { validPack } from './helpers.js';

function register(store) {
  return store.registerPack({
    pack: validPack(),
    proposer: { kind: 'HUMAN', id: 'human:local-reviewer' },
    registeredAt: '2026-09-01T01:00:00+08:00',
  });
}

function operatorRef(operatorId = 'visual.op.semantic.adjust_axis') {
  return { operatorId, version: '1.0.0' };
}

function artifact(artifactId, fill) {
  return { artifactId, sha256: fill.repeat(64) };
}

function delta(axisId, direction, magnitude) {
  return { axisId, direction, magnitude };
}

function prediction(ref) {
  return {
    schema: 'eve-atelier-visual-counterfactual-prediction/v1',
    predictionId: 'counterfactual:prediction:store:001',
    packRef: { packId: ref.packId, version: ref.version, digest: ref.digest },
    operatorRef: operatorRef(),
    artifactBefore: artifact('artifact:synthetic:before', 'b'),
    intervention: {
      target: { kind: 'art.document', id: 'document:synthetic:001' },
      axisChanges: [
        { axisId: 'semantic.axis.example.intensity', mode: 'SET', value: 0.4 },
      ],
      lockIds: ['semantic.lock.example.identity'],
      minimalClosureOperatorRefs: [operatorRef()],
    },
    predictedDeltas: [
      delta('semantic.axis.example.intensity', 'DECREASE', 'MEDIUM'),
    ],
    scopeRefs: ['scope:character-art:synthetic'],
    rationaleRefs: ['rationale:synthetic:functional:001'],
    alternativeRationaleRefs: ['rationale:synthetic:alternative:001'],
    evidenceRefs: ['evidence:synthetic:model-inference:001'],
    evidenceClass: 'MODEL_INFERENCE',
    provenance: { kind: 'AI', id: 'ai:counterfactual-proposer' },
    recordedAt: '2026-09-01T01:01:00+08:00',
  };
}

function observation(predictionId = 'counterfactual:prediction:store:001') {
  return {
    schema: 'eve-atelier-visual-counterfactual-observation/v1',
    observationId: 'counterfactual:observation:store:001',
    predictionId,
    artifactAfter: artifact('artifact:synthetic:after', 'c'),
    observedDeltas: [
      delta('semantic.axis.example.intensity', 'DECREASE', 'SMALL'),
    ],
    collateralDeltas: [
      delta('semantic.axis.example.identity', 'STABLE', 'SMALL'),
    ],
    evaluationRefs: ['evaluation:synthetic:001'],
    limitationRefs: ['limitation:single-synthetic-sample'],
    evidenceRefs: ['evidence:synthetic:generated-variant:001'],
    evidenceClass: 'GENERATED_VARIANT',
    provenance: { kind: 'SYSTEM', id: 'system:fixture-generator' },
    recordedAt: '2026-09-01T01:02:00+08:00',
  };
}

function proposal(ref, residualRef = 'counterfactual:observation:store:001') {
  return {
    schema: 'eve-atelier-operator-proposal/v1',
    proposalId: 'operator-proposal:store:001',
    basePackRef: { packId: ref.packId, version: ref.version, digest: ref.digest },
    proposedOperatorRef: operatorRef('visual.op.semantic.synthetic_relation'),
    decomposition: {
      kind: 'COMPOSITE',
      componentOperatorRefs: [operatorRef()],
    },
    scopeRefs: ['scope:character-art:synthetic'],
    residualRefs: [residualRef],
    rationaleRefs: ['rationale:synthetic:proposal:001'],
    evidenceRefs: ['evidence:synthetic:residual:001'],
    counterevidenceRefs: ['counterevidence:synthetic:001'],
    provenance: { kind: 'AI', id: 'ai:operator-proposer' },
    recordedAt: '2026-09-01T01:03:00+08:00',
  };
}

test('stores immutable prediction and observation separately and derives a residual comparison', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-vusd-store-'));
  const databasePath = join(directory, 'registry.sqlite');
  const store = new OperatorRegistryStore({ path: databasePath });
  let attacker;
  try {
    const ref = register(store);
    const predicted = prediction(ref);
    const observed = observation();
    const candidate = proposal(ref);

    assert.deepEqual(store.appendCounterfactualPrediction(predicted), predicted);
    assert.deepEqual(store.getCounterfactualPrediction(predicted.predictionId), predicted);
    assert.deepEqual(store.appendCounterfactualObservation(observed), observed);
    assert.deepEqual(
      store.listCounterfactualObservations({ predictionId: predicted.predictionId }),
      [observed],
    );
    assert.deepEqual(store.compareCounterfactual({
      predictionId: predicted.predictionId,
      observationId: observed.observationId,
    }), {
      schema: 'eve-atelier-visual-counterfactual-comparison/v1',
      predictionId: predicted.predictionId,
      observationId: observed.observationId,
      deltas: [
        {
          axisId: 'semantic.axis.example.intensity',
          status: 'PARTIAL',
          predicted: delta('semantic.axis.example.intensity', 'DECREASE', 'MEDIUM'),
          observed: delta('semantic.axis.example.intensity', 'DECREASE', 'SMALL'),
        },
        {
          axisId: 'semantic.axis.example.identity',
          status: 'COLLATERAL',
          observed: delta('semantic.axis.example.identity', 'STABLE', 'SMALL'),
        },
      ],
      summary: {
        MATCH: 0,
        PARTIAL: 1,
        MISMATCH: 0,
        UNRESOLVED: 0,
        COLLATERAL: 1,
      },
    });

    assert.deepEqual(store.appendOperatorProposal(candidate), candidate);
    assert.deepEqual(store.listOperatorProposals({
      proposedOperatorId: candidate.proposedOperatorRef.operatorId,
    }), [candidate]);

    attacker = new DatabaseSync(databasePath);
    const mutations = [
      'UPDATE counterfactual_predictions SET evidence_class = \'CONTROLLED_EXPERIMENT\'',
      'DELETE FROM counterfactual_predictions',
      'UPDATE counterfactual_observations SET evidence_class = \'CONTROLLED_EXPERIMENT\'',
      'DELETE FROM counterfactual_observations',
      'UPDATE operator_proposals SET proposed_operator_id = \'visual.op.fake\'',
      'DELETE FROM operator_proposals',
    ];
    for (const statement of mutations) {
      assert.throws(() => attacker.exec(statement), /append_only_(?:update|delete)_forbidden/);
    }
    const replacements = [
      [
        'INSERT OR REPLACE INTO counterfactual_predictions SELECT * FROM counterfactual_predictions WHERE prediction_id = ?',
        predicted.predictionId,
      ],
      [
        'INSERT OR REPLACE INTO counterfactual_observations SELECT * FROM counterfactual_observations WHERE observation_id = ?',
        observed.observationId,
      ],
      [
        'INSERT OR REPLACE INTO operator_proposals SELECT * FROM operator_proposals WHERE proposal_id = ?',
        candidate.proposalId,
      ],
    ];
    for (const [statement, id] of replacements) {
      assert.throws(
        () => attacker.prepare(statement).run(id),
        /append_only_replace_forbidden/,
      );
    }
  } finally {
    attacker?.close();
    store.close();
  }
});

test('classifies directional mismatch and unknown evidence without upgrading either to a match', () => {
  const cases = [
    {
      name: 'mismatch',
      predicted: delta('semantic.axis.example.intensity', 'DECREASE', 'MEDIUM'),
      observed: delta('semantic.axis.example.intensity', 'INCREASE', 'MEDIUM'),
      expected: 'MISMATCH',
    },
    {
      name: 'unknown',
      predicted: delta('semantic.axis.example.intensity', 'UNKNOWN', 'UNKNOWN'),
      observed: delta('semantic.axis.example.intensity', 'DECREASE', 'SMALL'),
      expected: 'UNRESOLVED',
    },
  ];

  for (const entry of cases) {
    const store = new OperatorRegistryStore({ path: ':memory:' });
    try {
      const ref = register(store);
      const predicted = prediction(ref);
      predicted.predictionId = `counterfactual:prediction:${entry.name}`;
      predicted.predictedDeltas = [entry.predicted];
      const observed = observation(predicted.predictionId);
      observed.observationId = `counterfactual:observation:${entry.name}`;
      observed.observedDeltas = [entry.observed];
      observed.collateralDeltas = [];
      store.appendCounterfactualPrediction(predicted);
      store.appendCounterfactualObservation(observed);
      const comparison = store.compareCounterfactual({
        predictionId: predicted.predictionId,
        observationId: observed.observationId,
      });
      assert.equal(comparison.deltas[0].status, entry.expected, entry.name);
      assert.equal(comparison.summary[entry.expected], 1, entry.name);
      assert.equal(comparison.summary.MATCH, 0, entry.name);
    } finally {
      store.close();
    }
  }
});

test('fails closed on dangling prediction, axes, closure operators, residuals, and components', () => {
  const cases = [
    ['observation without prediction', (store, ref) => {
      store.appendCounterfactualObservation(observation('counterfactual:prediction:missing'));
    }, /counterfactual_prediction_not_found/],
    ['observation not after prediction', (store, ref) => {
      const predicted = prediction(ref);
      store.appendCounterfactualPrediction(predicted);
      const observed = observation(predicted.predictionId);
      observed.recordedAt = predicted.recordedAt;
      store.appendCounterfactualObservation(observed);
    }, /counterfactual_observation_not_after_prediction/],
    ['unpredicted observation hidden outside collateral', (store, ref) => {
      const predicted = prediction(ref);
      store.appendCounterfactualPrediction(predicted);
      const observed = observation(predicted.predictionId);
      observed.observedDeltas = [
        delta('semantic.axis.example.identity', 'STABLE', 'SMALL'),
      ];
      observed.collateralDeltas = [];
      store.appendCounterfactualObservation(observed);
    }, /counterfactual_observation_unpredicted_axis:semantic.axis.example.identity/],
    ['predicted axis mislabeled as collateral', (store, ref) => {
      const predicted = prediction(ref);
      predicted.predictedDeltas.push(
        delta('semantic.axis.example.identity', 'STABLE', 'SMALL'),
      );
      store.appendCounterfactualPrediction(predicted);
      store.appendCounterfactualObservation(observation(predicted.predictionId));
    }, /counterfactual_observation_predicted_axis_as_collateral:semantic.axis.example.identity/],
    ['prediction with unknown delta axis', (store, ref) => {
      const value = prediction(ref);
      value.predictedDeltas[0].axisId = 'semantic.axis.missing';
      store.appendCounterfactualPrediction(value);
    }, /counterfactual_axis_not_found:semantic.axis.missing/],
    ['prediction omits operator-required lock', (store, ref) => {
      const value = prediction(ref);
      value.intervention.lockIds = [];
      store.appendCounterfactualPrediction(value);
    }, /counterfactual_required_lock_missing:semantic.lock.example.identity/],
    ['prediction targets a kind the operator cannot consume', (store, ref) => {
      const value = prediction(ref);
      value.intervention.target.kind = 'unrelated.kind';
      store.appendCounterfactualPrediction(value);
    }, /counterfactual_target_kind_not_supported:unrelated.kind/],
    ['prediction with unknown closure operator', (store, ref) => {
      const value = prediction(ref);
      value.intervention.minimalClosureOperatorRefs = [operatorRef('visual.op.missing')];
      store.appendCounterfactualPrediction(value);
    }, /counterfactual_closure_operator_not_found:visual.op.missing@1.0.0/],
    ['prediction closure omits intervention operator', (store, ref) => {
      const value = prediction(ref);
      value.intervention.minimalClosureOperatorRefs = [
        operatorRef('visual.op.raster.resize'),
      ];
      store.appendCounterfactualPrediction(value);
    }, /counterfactual_closure_source_operator_required:visual.op.semantic.adjust_axis@1.0.0/],
    ['proposal without residual', (store, ref) => {
      store.appendOperatorProposal(proposal(ref, 'counterfactual:observation:missing'));
    }, /operator_proposal_residual_not_found:counterfactual:observation:missing/],
    ['proposal with unknown component', (store, ref) => {
      const value = proposal(ref);
      value.decomposition.componentOperatorRefs = [operatorRef('visual.op.missing')];
      store.appendOperatorProposal(value);
    }, /operator_proposal_component_not_found:visual.op.missing@1.0.0/],
    ['proposal duplicates an exact existing operator', (store, ref) => {
      const predicted = prediction(ref);
      store.appendCounterfactualPrediction(predicted);
      const observed = observation(predicted.predictionId);
      store.appendCounterfactualObservation(observed);
      const value = proposal(ref, observed.observationId);
      value.proposedOperatorRef = operatorRef();
      store.appendOperatorProposal(value);
    }, /operator_proposal_already_defined:visual.op.semantic.adjust_axis@1.0.0/],
    ['proposal timestamp does not follow its residual', (store, ref) => {
      const predicted = prediction(ref);
      store.appendCounterfactualPrediction(predicted);
      const observed = observation(predicted.predictionId);
      store.appendCounterfactualObservation(observed);
      const value = proposal(ref, observed.observationId);
      value.recordedAt = observed.recordedAt;
      store.appendOperatorProposal(value);
    }, /operator_proposal_not_after_residual:counterfactual:observation:store:001/],
    ['proposal cites a perfect match as residual evidence', (store, ref) => {
      const predicted = prediction(ref);
      store.appendCounterfactualPrediction(predicted);
      const observed = observation(predicted.predictionId);
      observed.observedDeltas = [structuredClone(predicted.predictedDeltas[0])];
      observed.collateralDeltas = [];
      store.appendCounterfactualObservation(observed);
      store.appendOperatorProposal(proposal(ref, observed.observationId));
    }, /operator_proposal_residual_empty:counterfactual:observation:store:001/],
  ];

  for (const [name, action, expected] of cases) {
    const store = new OperatorRegistryStore({ path: ':memory:' });
    try {
      const ref = register(store);
      assert.throws(() => action(store, ref), expected, name);
    } finally {
      store.close();
    }
  }
});
