import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CalibrationEvidenceStore,
  adaptSameSeriesObservation,
} from '../../src/style-control/calibration-store.js';
import { SAME_SERIES_DIMENSIONS } from '../../src/style-control/contracts.js';

function scope() {
  return {
    kind: 'PROJECT_LOCAL',
    projectId: 'example:eveatelier-project',
    taskId: 'example:same-series-calibration',
  };
}

function artifact(artifactId, fill) {
  return { artifactId, sha256: fill.repeat(64) };
}

function evaluator() {
  return {
    evaluatorId: 'evaluator:synthetic:same-series',
    evaluatorVersion: '1.0.0',
    measurement: 'structured_visual_observation',
    limits: ['Synthetic contract evidence only.'],
  };
}

function profile(version = '1.0.0', extraDimensions = []) {
  const dimensions = [...SAME_SERIES_DIMENSIONS, ...extraDimensions].map(dimensionId => ({
    dimensionId,
    definitionVersion: version,
    description: `Versioned definition for ${dimensionId}.`,
    allowedStatuses: ['MATCH', 'DRIFT', 'UNKNOWN'],
  }));
  return {
    schema: 'eve-atelier-same-series-dimension-profile/v1',
    profileId: 'profile:eveatelier:same-series-core',
    version,
    maturity: 'EXPERIMENTAL_UNCALIBRATED',
    dimensions,
  };
}

function register(store, definition = profile()) {
  return store.registerProfile({
    profile: definition,
    proposer: { kind: 'HUMAN', id: 'human:local-reviewer' },
    registeredAt: '2026-09-10T20:00:00+08:00',
  });
}

function legacyObservation({
  observationId = 'observation:legacy:001',
  source = artifact('artifact:synthetic:source', 'a'),
  candidate = artifact('artifact:synthetic:candidate', 'b'),
} = {}) {
  const dimensions = Object.fromEntries(SAME_SERIES_DIMENSIONS.map(dimensionId => [
    dimensionId,
    {
      status: 'MATCH',
      confidence: 0.75,
      evidenceRefs: [`evidence:${dimensionId}:001`],
      notes: `Synthetic ${dimensionId} observation.`,
    },
  ]));
  return {
    schema: 'eve-atelier-same-series-observation/v1',
    observationId,
    stylePacketId: 'style-packet:synthetic:001',
    calibrationStatus: 'EXPERIMENTAL_UNCALIBRATED',
    scope: scope(),
    source,
    candidate,
    references: [artifact('artifact:synthetic:reference', 'c')],
    evaluator: evaluator(),
    dimensions,
    createdAt: '2026-09-10T20:01:00+08:00',
  };
}

function relation(kind = 'SAME_CHARACTER_EXACT_PAIR') {
  return {
    kind,
    leftCharacterRef: 'character:synthetic:001',
    rightCharacterRef: kind === 'SAME_CHARACTER_EXACT_PAIR'
      ? 'character:synthetic:001'
      : 'character:synthetic:counterexample',
  };
}

function adaptedObservation(profileDefinition, options = {}) {
  return adaptSameSeriesObservation({
    profile: profileDefinition,
    relation: relation(options.kind),
    observation: legacyObservation(options),
  });
}

function directObservation(ref, profileDefinition, {
  observationId = 'observation:dynamic:001',
  kind = 'SAME_CHARACTER_EXACT_PAIR',
  left = artifact('artifact:dynamic:left', 'd'),
  right = artifact('artifact:dynamic:right', 'e'),
} = {}) {
  return {
    schema: 'eve-atelier-calibration-observation/v1',
    observationId,
    profileRef: structuredClone(ref),
    stylePacketId: 'style-packet:synthetic:dynamic',
    scope: scope(),
    relation: relation(kind),
    artifacts: {
      left,
      right,
      references: [artifact('artifact:dynamic:reference', 'f')],
    },
    dimensions: profileDefinition.dimensions.map(definition => ({
      dimensionId: definition.dimensionId,
      definitionVersion: definition.definitionVersion,
      status: 'MATCH',
      confidence: 0.7,
      evidenceRefs: [`evidence:${definition.dimensionId}:dynamic`],
      notes: `Synthetic evidence for ${definition.dimensionId}.`,
      evaluator: evaluator(),
    })),
    recordedAt: '2026-09-10T20:01:00+08:00',
  };
}

function preference(ref, observation, {
  preferenceId,
  roundId,
  observerId,
  preferred,
} = {}) {
  return {
    schema: 'eve-atelier-calibration-preference/v1',
    preferenceId,
    profileRef: structuredClone(ref),
    observationId: observation.observationId,
    scope: structuredClone(observation.scope),
    roundId,
    observer: { kind: 'HUMAN', id: observerId },
    leftArtifact: structuredClone(observation.artifacts.left),
    rightArtifact: structuredClone(observation.artifacts.right),
    preferred,
    reason: 'Synthetic project-local preference evidence.',
    evidenceRefs: [`evidence:${preferenceId}`],
    observedAt: '2026-09-10T20:02:00+08:00',
  };
}

function finding(ref, observationIds, kind = 'FALSE_POSITIVE') {
  return {
    schema: 'eve-atelier-calibration-finding/v1',
    findingId: `finding:${kind.toLowerCase()}:001`,
    profileRef: structuredClone(ref),
    scope: scope(),
    kind,
    observationIds,
    evidenceRefs: ['evidence:synthetic:metric-audit'],
    rationale: 'Synthetic metric limitation retained as counterevidence.',
    reporter: { kind: 'HUMAN', id: 'human:metric-reviewer' },
    recordedAt: '2026-09-10T20:03:00+08:00',
  };
}

function thresholdCandidate(ref, {
  observationIds,
  preferenceIds,
  findingIds,
} = {}) {
  return {
    schema: 'eve-atelier-threshold-candidate/v1',
    candidateId: 'threshold-candidate:synthetic:001',
    profileRef: structuredClone(ref),
    scope: scope(),
    methodRef: {
      methodId: 'calibration.method.synthetic.placeholder',
      version: '1.0.0',
      parameterSetDigest: '9'.repeat(64),
    },
    observationIds,
    preferenceIds,
    findingIds,
    evidenceRefs: ['evidence:synthetic:derivation'],
    counterevidenceRefs: ['counterevidence:synthetic:known-limit'],
    limitations: ['Candidate-only payload; no calibrated claim.'],
    status: 'PROPOSED',
    proposer: { kind: 'AI', id: 'ai:threshold-proposer' },
    proposedAt: '2026-09-10T20:04:00+08:00',
  };
}

test('registers immutable versioned dimension profiles and preserves old semantics', () => {
  const store = new CalibrationEvidenceStore({ path: ':memory:' });
  try {
    const v1 = profile();
    const v1Ref = register(store, v1);
    assert.equal(store.getProfile(v1Ref).maturity, 'EXPERIMENTAL_UNCALIBRATED');
    assert.deepEqual(store.getProfile(v1Ref), v1);
    assert.deepEqual(register(store, v1), v1Ref);

    const drifted = profile();
    drifted.dimensions[0].description = 'Silent same-version semantic drift.';
    assert.throws(() => register(store, drifted), /calibration_profile_version_conflict/);

    const v2 = profile('2.0.0', ['lineStructure']);
    const v2Ref = register(store, v2);
    assert.notEqual(v2Ref.digest, v1Ref.digest);
    assert.deepEqual(store.getProfile(v1Ref), v1);
    assert.deepEqual(store.getProfile(v2Ref), v2);
  } finally {
    store.close();
  }
});

test('adapts legacy six-dimension evidence and accepts a later data-defined dimension', () => {
  const store = new CalibrationEvidenceStore({ path: ':memory:' });
  try {
    const v1 = profile();
    const v1Ref = register(store, v1);
    const legacy = adaptedObservation(v1);
    assert.deepEqual(legacy.profileRef, v1Ref);
    assert.deepEqual(store.appendObservation(legacy), legacy);

    const v2 = profile('2.0.0', ['lineStructure']);
    const v2Ref = register(store, v2);
    const dynamic = directObservation(v2Ref, v2);
    assert.equal(dynamic.dimensions.at(-1).dimensionId, 'lineStructure');
    assert.deepEqual(store.appendObservation(dynamic), dynamic);
    assert.deepEqual(store.getObservation(dynamic.observationId), dynamic);
  } finally {
    store.close();
  }
});

test('retains repeated pairwise rounds and derives disagreement without consensus', () => {
  const store = new CalibrationEvidenceStore({ path: ':memory:' });
  try {
    const definition = profile();
    const ref = register(store, definition);
    const observation = adaptedObservation(definition);
    store.appendObservation(observation);
    const events = [
      preference(ref, observation, {
        preferenceId: 'preference:round-1:left',
        roundId: 'round:001',
        observerId: 'human:observer:a',
        preferred: 'LEFT',
      }),
      preference(ref, observation, {
        preferenceId: 'preference:round-1:right',
        roundId: 'round:001',
        observerId: 'human:observer:b',
        preferred: 'RIGHT',
      }),
      preference(ref, observation, {
        preferenceId: 'preference:round-2:tie',
        roundId: 'round:002',
        observerId: 'human:observer:a',
        preferred: 'TIE',
      }),
    ];
    for (const event of events) store.appendPreference(event);

    assert.deepEqual(store.listPreferences({ observationId: observation.observationId }), events);
    const summary = store.summarizePreferences({ observationId: observation.observationId });
    assert.equal(summary.rounds.length, 2);
    assert.equal(summary.rounds[0].disagreement, true);
    assert.deepEqual(summary.rounds[0].choices, { LEFT: 1, RIGHT: 1, TIE: 0, NEITHER: 0 });
    assert.equal(summary.consensus, undefined);
    assert.equal(summary.authorizesCalibration, false);

    assert.throws(
      () => store.appendPreference(preference(ref, observation, {
        preferenceId: 'preference:round-1:duplicate-observer',
        roundId: 'round:001',
        observerId: 'human:observer:a',
        preferred: 'RIGHT',
      })),
      /calibration_preference_observer_round_conflict/,
    );
  } finally {
    store.close();
  }
});

test('stores counterevidence and threshold candidates without creating authority', () => {
  const store = new CalibrationEvidenceStore({ path: ':memory:' });
  try {
    const definition = profile();
    const ref = register(store, definition);
    const exact = adaptedObservation(definition);
    const counterexample = adaptedObservation(definition, {
      observationId: 'observation:counterexample:001',
      kind: 'CROSS_CHARACTER_COUNTEREXAMPLE',
      source: artifact('artifact:counterexample:source', 'd'),
      candidate: artifact('artifact:counterexample:candidate', 'e'),
    });
    store.appendObservation(exact);
    store.appendObservation(counterexample);
    store.appendObservation(adaptedObservation(definition, {
      observationId: 'observation:exact-pair:repeated-measurement',
    }));
    const preferences = [
      preference(ref, exact, {
        preferenceId: 'preference:threshold:001',
        roundId: 'round:001',
        observerId: 'human:observer:a',
        preferred: 'RIGHT',
      }),
      preference(ref, exact, {
        preferenceId: 'preference:threshold:002',
        roundId: 'round:002',
        observerId: 'human:observer:a',
        preferred: 'LEFT',
      }),
    ];
    for (const event of preferences) store.appendPreference(event);
    const limitation = finding(ref, [exact.observationId, counterexample.observationId]);
    store.appendFinding(limitation);
    const candidate = thresholdCandidate(ref, {
      observationIds: [exact.observationId, counterexample.observationId],
      preferenceIds: preferences.map(event => event.preferenceId),
      findingIds: [limitation.findingId],
    });

    assert.deepEqual(store.appendThresholdCandidate(candidate), candidate);
    assert.deepEqual(store.listThresholdCandidates({ profileRef: ref }), [candidate]);
    assert.equal(typeof store.activateThresholdCandidate, 'undefined');
    for (const [name, mutate] of [
      ['active status', value => { value.status = 'ACTIVE'; }],
      ['hidden acceptance', value => { value.acceptance = 'ACCEPT'; }],
    ]) {
      const selfAuthorized = structuredClone(candidate);
      selfAuthorized.candidateId = `threshold-candidate:self-authorized:${name}`;
      mutate(selfAuthorized);
      assert.throws(
        () => store.appendThresholdCandidate(selfAuthorized),
        /threshold_candidate_invalid/,
        name,
      );
    }
    assert.deepEqual(store.listThresholdCandidates({ profileRef: ref }), [candidate]);
    const summary = store.summarizeEvidence({ profileRef: ref, scope: scope() });
    assert.deepEqual(summary.counts, {
      sameCharacterExactPairs: 1,
      crossCharacterCounterexamples: 1,
      preferenceRounds: 2,
      disagreementRounds: 0,
      falsePositiveFindings: 1,
      metricBlindnessFindings: 0,
      thresholdCandidates: 1,
    });
    assert.equal(summary.calibrationStatus, 'EXPERIMENTAL_UNCALIBRATED');
    assert.deepEqual(summary.authority, {
      calibration: false,
      activation: false,
      visualAcceptance: false,
      workbenchPromotion: false,
      mrmicMutation: false,
    });
  } finally {
    store.close();
  }
});

test('binds threshold candidates to one exact evidence closure and later time', () => {
  const store = new CalibrationEvidenceStore({ path: ':memory:' });
  try {
    const definition = profile();
    const ref = register(store, definition);
    const exact = adaptedObservation(definition);
    const counterexample = adaptedObservation(definition, {
      observationId: 'observation:counterexample:closure',
      kind: 'CROSS_CHARACTER_COUNTEREXAMPLE',
      source: artifact('artifact:closure:counter-source', 'd'),
      candidate: artifact('artifact:closure:counter-candidate', 'e'),
    });
    const unrelated = adaptedObservation(definition, {
      observationId: 'observation:unrelated:closure',
      source: artifact('artifact:closure:unrelated-source', 'f'),
      candidate: artifact('artifact:closure:unrelated-candidate', '1'),
    });
    for (const observation of [exact, counterexample, unrelated]) {
      store.appendObservation(observation);
    }
    const first = preference(ref, exact, {
      preferenceId: 'preference:closure:001',
      roundId: 'round:001',
      observerId: 'human:observer:a',
      preferred: 'RIGHT',
    });
    const second = preference(ref, exact, {
      preferenceId: 'preference:closure:002',
      roundId: 'round:002',
      observerId: 'human:observer:a',
      preferred: 'LEFT',
    });
    const unrelatedPreference = preference(ref, unrelated, {
      preferenceId: 'preference:closure:unrelated',
      roundId: 'round:002',
      observerId: 'human:observer:b',
      preferred: 'RIGHT',
    });
    for (const event of [first, second, unrelatedPreference]) store.appendPreference(event);
    const retainedFinding = finding(ref, [exact.observationId, counterexample.observationId]);
    const unrelatedFinding = finding(ref, [unrelated.observationId], 'METRIC_BLINDNESS');
    for (const event of [retainedFinding, unrelatedFinding]) store.appendFinding(event);

    const base = thresholdCandidate(ref, {
      observationIds: [exact.observationId, counterexample.observationId],
      preferenceIds: [first.preferenceId, second.preferenceId],
      findingIds: [retainedFinding.findingId],
    });
    const cases = [
      [
        'unbound preference',
        value => { value.preferenceIds[1] = unrelatedPreference.preferenceId; },
        /threshold_candidate_preference_observation_unbound:preference:closure:unrelated/,
      ],
      [
        'unbound finding',
        value => { value.findingIds = [unrelatedFinding.findingId]; },
        /threshold_candidate_finding_observation_unbound:finding:metric_blindness:001:observation:unrelated:closure/,
      ],
      [
        'premature proposal',
        value => { value.proposedAt = retainedFinding.recordedAt; },
        /threshold_candidate_not_after_evidence/,
      ],
    ];
    for (const [name, mutate, expected] of cases) {
      const candidate = structuredClone(base);
      candidate.candidateId = `threshold-candidate:invalid:${name}`;
      mutate(candidate);
      assert.throws(() => store.appendThresholdCandidate(candidate), expected, name);
    }
    assert.deepEqual(store.listThresholdCandidates({ profileRef: ref }), []);
  } finally {
    store.close();
  }
});

test('fails closed on path leakage, malformed time, wrong relations, and dangling evidence', () => {
  const store = new CalibrationEvidenceStore({ path: ':memory:' });
  try {
    const definition = profile();
    const ref = register(store, definition);
    const cases = [
      ['path leakage', value => { value.artifacts.left.path = 'D:\\private\\image.png'; }, /calibration_artifact_field_forbidden:path/],
      ['nonexistent date', value => { value.recordedAt = '2026-02-30T00:00:00Z'; }, /calibration_observation_recorded_at_invalid/],
      ['same-character mismatch', value => { value.relation.rightCharacterRef = 'character:other'; }, /calibration_same_character_binding_mismatch/],
      ['duplicate artifact', value => { value.artifacts.right = structuredClone(value.artifacts.left); }, /calibration_observation_distinct_artifacts_required/],
    ];
    for (const [name, mutate, expected] of cases) {
      const value = adaptedObservation(definition, { observationId: `observation:invalid:${name}` });
      mutate(value);
      assert.throws(() => store.appendObservation(value), expected, name);
      assert.throws(() => store.getObservation(value.observationId), /calibration_observation_not_found/);
    }

    const unstable = adaptedObservation(definition, { observationId: 'observation:proxy:failure' });
    unstable.relation = new Proxy(unstable.relation, {
      ownKeys() { throw new Error('proxy_snapshot_failed'); },
    });
    assert.throws(() => store.appendObservation(unstable), /calibration_observation_json_value_invalid/);

    const valid = adaptedObservation(definition);
    store.appendObservation(valid);
    const dangling = finding(ref, ['observation:missing']);
    assert.throws(() => store.appendFinding(dangling), /calibration_finding_observation_not_found:observation:missing/);
    assert.deepEqual(store.listFindings({ profileRef: ref }), []);
  } finally {
    store.close();
  }
});

test('persists exact evidence across reopen and blocks SQL update, delete, and replace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-calibration-store-'));
  const databasePath = join(directory, 'calibration.sqlite');
  const definition = profile();
  let store = new CalibrationEvidenceStore({ path: databasePath });
  const ref = register(store, definition);
  const observation = adaptedObservation(definition);
  const counterexample = adaptedObservation(definition, {
    observationId: 'observation:persistence:counterexample',
    kind: 'CROSS_CHARACTER_COUNTEREXAMPLE',
    source: artifact('artifact:persistence:counter-source', 'd'),
    candidate: artifact('artifact:persistence:counter-candidate', 'e'),
  });
  store.appendObservation(observation);
  store.appendObservation(counterexample);
  const preferences = [
    preference(ref, observation, {
      preferenceId: 'preference:persistence:001',
      roundId: 'round:001',
      observerId: 'human:persistence:a',
      preferred: 'LEFT',
    }),
    preference(ref, observation, {
      preferenceId: 'preference:persistence:002',
      roundId: 'round:002',
      observerId: 'human:persistence:a',
      preferred: 'RIGHT',
    }),
  ];
  for (const event of preferences) store.appendPreference(event);
  const limitation = finding(ref, [observation.observationId, counterexample.observationId]);
  store.appendFinding(limitation);
  const candidate = thresholdCandidate(ref, {
    observationIds: [observation.observationId, counterexample.observationId],
    preferenceIds: preferences.map(event => event.preferenceId),
    findingIds: [limitation.findingId],
  });
  store.appendThresholdCandidate(candidate);
  store.close();

  store = new CalibrationEvidenceStore({ path: databasePath });
  let attacker;
  try {
    assert.deepEqual(store.getProfile(ref), definition);
    assert.deepEqual(store.getObservation(observation.observationId), observation);
    assert.deepEqual(store.listPreferences({ observationId: observation.observationId }), preferences);
    assert.deepEqual(store.listFindings({ profileRef: ref }), [limitation]);
    assert.deepEqual(store.listThresholdCandidates({ profileRef: ref }), [candidate]);
    attacker = new DatabaseSync(databasePath);
    for (const statement of [
      "UPDATE calibration_profiles SET proposer_id = 'changed'",
      'DELETE FROM calibration_profiles',
      "UPDATE calibration_observations SET relation_kind = 'CROSS_CHARACTER_COUNTEREXAMPLE'",
      'DELETE FROM calibration_observations',
      "UPDATE calibration_preferences SET preferred = 'NEITHER'",
      'DELETE FROM calibration_preferences',
      "UPDATE calibration_findings SET finding_kind = 'METRIC_BLINDNESS'",
      'DELETE FROM calibration_findings',
      "UPDATE threshold_candidates SET status = 'ACTIVE'",
      'DELETE FROM threshold_candidates',
      'INSERT OR REPLACE INTO calibration_profiles SELECT * FROM calibration_profiles',
      'INSERT OR REPLACE INTO calibration_observations SELECT * FROM calibration_observations',
      'INSERT OR REPLACE INTO calibration_preferences SELECT * FROM calibration_preferences',
      'INSERT OR REPLACE INTO calibration_findings SELECT * FROM calibration_findings',
      'INSERT OR REPLACE INTO threshold_candidates SELECT * FROM threshold_candidates',
    ]) {
      assert.throws(
        () => attacker.exec(statement),
        /append_only_(?:update|delete|replace)_forbidden/,
        statement,
      );
    }
  } finally {
    attacker?.close();
    store.close();
  }
});
