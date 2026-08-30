const scoreThresholdPairs = Object.freeze([
  ['identity', 'identityMin', 'identity_below_threshold'],
  ['lineAlignment', 'lineAlignmentMin', 'line_alignment_below_threshold'],
  ['colorAlignment', 'colorAlignmentMin', 'color_alignment_below_threshold'],
  ['styleAlignment', 'styleAlignmentMin', 'style_alignment_below_threshold'],
  ['artifactQuality', 'artifactQualityMin', 'artifact_quality_below_threshold'],
]);

function artifactIsValid(value) {
  return value?.decoded === true
    && Number.isInteger(value.width) && value.width > 0
    && Number.isInteger(value.height) && value.height > 0
    && Number.isInteger(value.bytes) && value.bytes > 0
    && Number.isInteger(value.nonEmptyPixels) && value.nonEmptyPixels > 0
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(value.sha256);
}

function evaluatorIsIdentified(value) {
  return value
    && typeof value.evaluatorId === 'string' && value.evaluatorId.length > 0
    && typeof value.evaluatorVersion === 'string' && value.evaluatorVersion.length > 0
    && typeof value.modelId === 'string' && value.modelId.length > 0
    && value.measurement === 'representation_similarity';
}

function thresholdsAreCalibrated(value) {
  if (value?.calibrationStatus !== 'CALIBRATED'
      || typeof value.thresholdSetId !== 'string'
      || value.thresholdSetId.length === 0
      || typeof value.calibrationFixtureSet !== 'string'
      || value.calibrationFixtureSet.length === 0) return false;
  const numericKeys = [
    'identityMin', 'lineAlignmentMin', 'colorAlignmentMin',
    'styleAlignmentMin', 'artifactQualityMin', 'negativeReferenceMax',
  ];
  return numericKeys.every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1);
}

function scoresAreComplete(value) {
  const keys = [
    'identity', 'lineAlignment', 'colorAlignment',
    'styleAlignment', 'artifactQuality', 'negativeReferenceSimilarity',
  ];
  return value && keys.every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1);
}

function result(input, verdict, failures) {
  const warnings = Array.isArray(input.warnings) ? [...input.warnings] : [];
  return {
    verdict,
    failures,
    warnings,
    artifact: structuredClone(input.artifact ?? null),
    scores: structuredClone(input.scores ?? null),
    thresholds: structuredClone(input.thresholds ?? null),
    evaluator: structuredClone(input.evaluator ?? null),
  };
}

export function decideCharacterRemasterVerdict(input = {}) {
  if (!artifactIsValid(input.artifact)) return result(input, 'REJECT', ['artifact_invalid']);
  if (!evaluatorIsIdentified(input.evaluator)) {
    return result(input, 'UNVERIFIED', ['evaluator_not_identified']);
  }
  if (!thresholdsAreCalibrated(input.thresholds)) {
    return result(input, 'UNVERIFIED', ['thresholds_not_calibrated']);
  }
  if (!scoresAreComplete(input.scores)) {
    return result(input, 'UNVERIFIED', ['required_scores_missing']);
  }
  if (input.scores.negativeReferenceSimilarity > input.thresholds.negativeReferenceMax) {
    return result(input, 'REJECT', ['negative_reference_violation']);
  }

  const failures = scoreThresholdPairs
    .filter(([score, threshold]) => input.scores[score] < input.thresholds[threshold])
    .map(([, , failure]) => failure);
  if (failures.length > 0) return result(input, 'REPAIR', failures);

  const warnings = Array.isArray(input.warnings) ? input.warnings : [];
  return result(input, warnings.length > 0 ? 'ACCEPT_WITH_WARNINGS' : 'ACCEPT', []);
}
