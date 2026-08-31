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
    observationId: 'same-series:1086:candidate-02:01',
    stylePacketId: 'style-packet:character-remaster-1086:01',
    calibrationStatus: 'EXPERIMENTAL_UNCALIBRATED',
    source: artifact('private-source:wanxiang-role-1086', 'a'),
    candidate: artifact('private-candidate:1086-derived-02', 'b'),
    references: [artifact('private-reference:style-core-01', 'c')],
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
    preferenceId: 'preference:1086-derived:01',
    scope: {
      kind: 'PROJECT_LOCAL',
      projectId: 'EveAtelier',
      taskId: 'character-remaster-1086',
    },
    leftArtifactId: 'private-candidate:1086-derived-01',
    rightArtifactId: 'private-candidate:1086-derived-02',
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
    preferenceId: 'preference:1086-derived:universal',
    scope: {
      kind: 'PROJECT_LOCAL',
      projectId: 'EveAtelier',
      taskId: 'character-remaster-1086',
      universal: true,
    },
    leftArtifactId: 'private-candidate:1086-derived-01',
    rightArtifactId: 'private-candidate:1086-derived-02',
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
      projectId: 'EveAtelier',
      taskId: 'character-remaster-1086',
    },
    leftArtifactId: 'private-candidate:unrelated-01',
    rightArtifactId: 'private-candidate:unrelated-02',
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
