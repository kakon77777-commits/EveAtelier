import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAME_SERIES_DIMENSIONS,
  classifySameSeriesObservation,
  createSameSeriesReview,
  validateHumanPairwisePreference,
  validateSameSeriesObservation,
} from '../../src/style-control/contracts.js';

function artifact(artifactId, hashCharacter) {
  return { artifactId, sha256: hashCharacter.repeat(64) };
}

function completeObservation() {
  const dimensions = Object.fromEntries(SAME_SERIES_DIMENSIONS.map(dimension => [
    dimension,
    {
      status: 'MATCH',
      confidence: 0.75,
      evidenceRefs: [`evidence:${dimension}:01`],
      notes: `Bounded observation for ${dimension}`,
    },
  ]));
  return {
    schema: 'eve-atelier-same-series-observation/v1',
    observationId: 'example:same-series:candidate-right:01',
    stylePacketId: 'example:style-packet:01',
    calibrationStatus: 'EXPERIMENTAL_UNCALIBRATED',
    scope: {
      kind: 'PROJECT_LOCAL',
      projectId: 'example:eveatelier-project',
      taskId: 'example:character-style-task:01',
    },
    source: artifact('example:source:01', 'a'),
    candidate: artifact('example:candidate:right', 'b'),
    references: [artifact('example:style-core-reference:01', 'c')],
    evaluator: {
      evaluatorId: 'human-assisted:same-series-observer',
      evaluatorVersion: '0.1.0',
      measurement: 'structured_visual_observation',
      limits: [
        'No calibrated acceptance thresholds.',
        'Observation is conditional on the supplied references.',
      ],
    },
    dimensions,
    createdAt: '2026-08-31T00:00:00+08:00',
  };
}

test('retains all six dimensions but leaves a complete uncalibrated observation unverified', () => {
  const observation = completeObservation();

  assert.deepEqual(validateSameSeriesObservation(observation), { ok: true });
  assert.deepEqual(SAME_SERIES_DIMENSIONS, [
    'surfaceRendering',
    'proportionSyntax',
    'garmentVolume',
    'compositionRhythm',
    'detailLanguage',
    'paletteCompatibility',
  ]);
  assert.deepEqual(classifySameSeriesObservation(observation), {
    verdict: 'UNVERIFIED',
    calibrationStatus: 'EXPERIMENTAL_UNCALIBRATED',
    blockers: ['same_series_thresholds_not_calibrated'],
  });
});

test('keeps a project-local human preference separate from uncalibrated acceptance', () => {
  const observation = completeObservation();
  const preference = {
    schema: 'eve-atelier-human-pairwise-preference/v1',
    preferenceId: 'example:preference:01',
    scope: {
      kind: 'PROJECT_LOCAL',
      projectId: 'example:eveatelier-project',
      taskId: 'example:character-style-task:01',
    },
    leftArtifact: artifact('example:candidate:left', 'd'),
    rightArtifact: artifact('example:candidate:right', 'b'),
    preferred: 'RIGHT',
    reason: 'The right image better matches the current project direction.',
    observedAt: '2026-08-31T00:00:00+08:00',
    evidenceClass: 'human_observed',
  };

  assert.deepEqual(validateHumanPairwisePreference(preference), { ok: true });
  const review = createSameSeriesReview({ observation, humanPreference: preference });
  assert.deepEqual(review.observationDecision, {
    verdict: 'UNVERIFIED',
    calibrationStatus: 'EXPERIMENTAL_UNCALIBRATED',
    blockers: ['same_series_thresholds_not_calibrated'],
  });
  assert.deepEqual(review.humanPreference, preference);
  assert.equal('acceptance' in review, false);
  assert.equal('promotion' in review, false);
});

test('rejects a preference that makes a universal quality claim', () => {
  const preference = {
    schema: 'eve-atelier-human-pairwise-preference/v1',
    preferenceId: 'example:preference:universal',
    scope: {
      kind: 'PROJECT_LOCAL',
      projectId: 'example:eveatelier-project',
      taskId: 'example:character-style-task:01',
      universal: true,
    },
    leftArtifact: artifact('example:candidate:left', 'd'),
    rightArtifact: artifact('example:candidate:right', 'b'),
    preferred: 'RIGHT',
    reason: 'This image is universally better.',
    observedAt: '2026-08-31T00:00:00+08:00',
    evidenceClass: 'human_observed',
  };

  assert.deepEqual(validateHumanPairwisePreference(preference), {
    ok: false,
    reason: 'human_preference_universal_scope_forbidden',
  });
});

test('rejects a review whose preference pair is unrelated to the observed candidate', () => {
  const humanPreference = {
    schema: 'eve-atelier-human-pairwise-preference/v1',
    preferenceId: 'preference:unrelated:01',
    scope: {
      kind: 'PROJECT_LOCAL',
      projectId: 'example:eveatelier-project',
      taskId: 'example:character-style-task:01',
    },
    leftArtifact: artifact('example:unrelated-candidate:01', 'd'),
    rightArtifact: artifact('example:unrelated-candidate:02', 'e'),
    preferred: 'LEFT',
    reason: 'Valid pairwise evidence for a different comparison.',
    observedAt: '2026-08-31T00:00:00+08:00',
    evidenceClass: 'human_observed',
  };

  assert.throws(
    () => createSameSeriesReview({ observation: completeObservation(), humanPreference }),
    /human_preference_not_bound_to_observation_candidate/,
  );
});

test('binds pairwise preference to the exact candidate bytes and observation scope', () => {
  const observation = completeObservation();
  const preference = {
    schema: 'eve-atelier-human-pairwise-preference/v1',
    preferenceId: 'preference:bound:01',
    scope: structuredClone(observation.scope),
    leftArtifact: artifact('example:candidate:left', 'd'),
    rightArtifact: artifact(observation.candidate.artifactId, 'c'),
    preferred: 'RIGHT',
    reason: 'The right candidate better matches the current project direction.',
    observedAt: '2026-08-31T00:00:00+08:00',
    evidenceClass: 'human_observed',
  };

  assert.throws(
    () => createSameSeriesReview({ observation, humanPreference: preference }),
    /human_preference_not_bound_to_observation_candidate_bytes/,
  );

  preference.rightArtifact.sha256 = observation.candidate.sha256;
  preference.scope.taskId = 'different-task';
  assert.throws(
    () => createSameSeriesReview({ observation, humanPreference: preference }),
    /human_preference_scope_mismatch/,
  );
});

test('rejects unknown outcome fields in preferences and review assembly', () => {
  const observation = completeObservation();
  const humanPreference = {
    schema: 'eve-atelier-human-pairwise-preference/v1',
    preferenceId: 'preference:outcome:01',
    scope: structuredClone(observation.scope),
    leftArtifact: artifact('example:candidate:left', 'd'),
    rightArtifact: structuredClone(observation.candidate),
    preferred: 'RIGHT',
    reason: 'Bounded project-local preference.',
    observedAt: '2026-08-31T00:00:00+08:00',
    evidenceClass: 'human_observed',
    promotion: true,
  };

  assert.deepEqual(validateHumanPairwisePreference(humanPreference), {
    ok: false,
    reason: 'human_preference_field_forbidden:promotion',
  });
  delete humanPreference.promotion;
  assert.throws(
    () => createSameSeriesReview({ observation, humanPreference, acceptance: 'ACCEPT' }),
    /same_series_review_field_forbidden:acceptance/,
  );
});

test('fails closed on incomplete, scalar-only, malformed, or prematurely calibrated observations', () => {
  const cases = [
    [
      'missing dimension',
      observation => { delete observation.dimensions.surfaceRendering; },
      'same_series_dimension_required:surfaceRendering',
    ],
    [
      'scalar score',
      observation => { observation.styleScore = 0.95; },
      'same_series_scalar_score_forbidden',
    ],
    [
      'out-of-range confidence',
      observation => { observation.dimensions.garmentVolume.confidence = 1.01; },
      'same_series_dimension_confidence_invalid:garmentVolume',
    ],
    [
      'missing evaluator version',
      observation => { delete observation.evaluator.evaluatorVersion; },
      'same_series_evaluator_version_required',
    ],
    [
      'unsupported calibrated claim',
      observation => { observation.calibrationStatus = 'CALIBRATED'; },
      'same_series_calibration_status_must_be_experimental_uncalibrated',
    ],
  ];

  for (const [name, mutate, reason] of cases) {
    const observation = completeObservation();
    mutate(observation);
    assert.deepEqual(validateSameSeriesObservation(observation), { ok: false, reason }, name);
    assert.equal(classifySameSeriesObservation(observation).verdict, 'INVALID', name);
  }
});

test('rejects unknown outcome, path, provider, and dimension fields in observations', () => {
  const cases = [
    [
      'outcome',
      observation => { observation.acceptance = 'ACCEPT'; },
      'same_series_observation_field_forbidden:acceptance',
    ],
    [
      'artifact path',
      observation => { observation.source.path = 'D:\\private\\source.png'; },
      'source_artifact_field_forbidden:path',
    ],
    [
      'provider parameters',
      observation => { observation.evaluator.providerParameters = { model: 'private' }; },
      'same_series_evaluator_field_forbidden:providerParameters',
    ],
    [
      'dimension outcome',
      observation => { observation.dimensions.detailLanguage.promotion = true; },
      'same_series_dimension_field_forbidden:detailLanguage:promotion',
    ],
  ];

  for (const [name, mutate, reason] of cases) {
    const observation = completeObservation();
    mutate(observation);
    assert.deepEqual(validateSameSeriesObservation(observation), { ok: false, reason }, name);
  }
});
