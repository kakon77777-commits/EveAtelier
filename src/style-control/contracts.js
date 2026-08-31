export const STYLE_CONTROL_LAYERS = Object.freeze([
  'surfaceRendering',
  'proportionSyntax',
  'garmentVolume',
  'compositionRhythm',
  'paletteCompatibility',
]);

export const SAME_SERIES_DIMENSIONS = Object.freeze([
  'surfaceRendering',
  'proportionSyntax',
  'garmentVolume',
  'compositionRhythm',
  'detailLanguage',
  'paletteCompatibility',
]);

const constraintStrengths = Object.freeze(['hard', 'strong', 'medium', 'soft']);
const referenceInfluenceDimensions = Object.freeze([
  ...STYLE_CONTROL_LAYERS,
  'detailLanguage',
]);
const identityInfluenceDimensions = Object.freeze([
  'faceIdentity',
  'gender',
  'characterIdentity',
  'costumeIdentity',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validateStyle(style) {
  if (!isObject(style)) return 'style_definition_required';
  if (style.schema !== 'eve-atelier-style-definition/v1') return 'unsupported_style_definition_schema';
  if (!isNonEmptyString(style.styleId)) return 'style_id_required';
  if (style.maturity !== 'EXPERIMENTAL') return 'style_maturity_must_be_experimental';
  if (!isObject(style.layers)) return 'style_layers_required';
  for (const layer of STYLE_CONTROL_LAYERS) {
    if (!isObject(style.layers[layer])) return `style_layer_required:${layer}`;
  }
  if (!isObject(style.constraints)) return 'style_constraints_required';
  for (const strength of constraintStrengths) {
    const entries = style.constraints[strength];
    if (!Array.isArray(entries)
        || entries.some(entry => !isNonEmptyString(entry))) {
      return `style_constraints_invalid:${strength}`;
    }
  }
  return null;
}

function validateReference(reference) {
  if (!isObject(reference)) return 'style_reference_must_be_object';
  if (!isNonEmptyString(reference.assetId)) return 'style_reference_asset_id_required';
  if (!isSha256(reference.sha256)) return 'style_reference_sha256_required';
  if (!isNonEmptyString(reference.role)) return 'style_reference_role_required';
  if (!isObject(reference.allowedInfluence)) return 'style_reference_influence_mask_required';
  for (const dimension of referenceInfluenceDimensions) {
    if (typeof reference.allowedInfluence[dimension] !== 'boolean') {
      return `style_reference_influence_flag_required:${dimension}`;
    }
  }
  for (const dimension of identityInfluenceDimensions) {
    if (reference.allowedInfluence[dimension] !== false) {
      return `style_reference_identity_influence_forbidden:${dimension}`;
    }
  }
  return null;
}

function validateArtifactIdentity(value, label) {
  if (!isObject(value)) return `${label}_artifact_required`;
  if (!isNonEmptyString(value.artifactId)) return `${label}_artifact_id_required`;
  if (!isSha256(value.sha256)) return `${label}_artifact_sha256_required`;
  return null;
}

function validateEvaluator(value) {
  if (!isObject(value)) return 'same_series_evaluator_required';
  if (!isNonEmptyString(value.evaluatorId)) return 'same_series_evaluator_id_required';
  if (!isNonEmptyString(value.evaluatorVersion)) return 'same_series_evaluator_version_required';
  if (!isNonEmptyString(value.measurement)) return 'same_series_measurement_required';
  if (!Array.isArray(value.limits)
      || value.limits.length === 0
      || value.limits.some(limit => !isNonEmptyString(limit))) {
    return 'same_series_evaluator_limits_required';
  }
  return null;
}

function validateDimension(value, dimension) {
  if (!isObject(value)) return `same_series_dimension_required:${dimension}`;
  if (!['MATCH', 'DRIFT', 'UNKNOWN'].includes(value.status)) {
    return `same_series_dimension_status_invalid:${dimension}`;
  }
  if (!Number.isFinite(value.confidence)
      || value.confidence < 0
      || value.confidence > 1) {
    return `same_series_dimension_confidence_invalid:${dimension}`;
  }
  if (!Array.isArray(value.evidenceRefs)
      || value.evidenceRefs.length === 0
      || value.evidenceRefs.some(reference => !isNonEmptyString(reference))) {
    return `same_series_dimension_evidence_required:${dimension}`;
  }
  if (value.notes !== undefined && !isNonEmptyString(value.notes)) {
    return `same_series_dimension_notes_invalid:${dimension}`;
  }
  return null;
}

export function compileStyleConstraintPacket({ packetId, taskId, style, references } = {}) {
  if (!isNonEmptyString(packetId)) throw new TypeError('packet_id_required');
  if (!isNonEmptyString(taskId)) throw new TypeError('task_id_required');
  const styleFailure = validateStyle(style);
  if (styleFailure) throw new Error(styleFailure);
  if (!Array.isArray(references) || references.length === 0) {
    throw new TypeError('style_references_required');
  }
  for (const reference of references) {
    const referenceFailure = validateReference(reference);
    if (referenceFailure) throw new Error(referenceFailure);
  }

  return {
    schema: 'eve-atelier-style-constraint-packet/v1',
    packetId,
    taskId,
    styleId: style.styleId,
    maturity: style.maturity,
    controlLayers: structuredClone(style.layers),
    constraints: structuredClone(style.constraints),
    references: structuredClone(references),
  };
}

export function validateSameSeriesObservation(value) {
  if (!isObject(value)) return { ok: false, reason: 'same_series_observation_required' };
  if (value.schema !== 'eve-atelier-same-series-observation/v1') {
    return { ok: false, reason: 'unsupported_same_series_observation_schema' };
  }
  if (!isNonEmptyString(value.observationId)) {
    return { ok: false, reason: 'same_series_observation_id_required' };
  }
  if (!isNonEmptyString(value.stylePacketId)) {
    return { ok: false, reason: 'same_series_style_packet_id_required' };
  }
  if (value.calibrationStatus !== 'EXPERIMENTAL_UNCALIBRATED') {
    return { ok: false, reason: 'same_series_calibration_status_must_be_experimental_uncalibrated' };
  }
  if ('styleScore' in value) {
    return { ok: false, reason: 'same_series_scalar_score_forbidden' };
  }
  const sourceFailure = validateArtifactIdentity(value.source, 'source');
  if (sourceFailure) return { ok: false, reason: sourceFailure };
  const candidateFailure = validateArtifactIdentity(value.candidate, 'candidate');
  if (candidateFailure) return { ok: false, reason: candidateFailure };
  if (!Array.isArray(value.references) || value.references.length === 0) {
    return { ok: false, reason: 'same_series_references_required' };
  }
  for (const reference of value.references) {
    const referenceFailure = validateArtifactIdentity(reference, 'reference');
    if (referenceFailure) return { ok: false, reason: referenceFailure };
  }
  const evaluatorFailure = validateEvaluator(value.evaluator);
  if (evaluatorFailure) return { ok: false, reason: evaluatorFailure };
  if (!isObject(value.dimensions)) {
    return { ok: false, reason: 'same_series_dimensions_required' };
  }
  for (const dimension of SAME_SERIES_DIMENSIONS) {
    const dimensionFailure = validateDimension(value.dimensions[dimension], dimension);
    if (dimensionFailure) return { ok: false, reason: dimensionFailure };
  }
  const unknownDimension = Object.keys(value.dimensions)
    .find(dimension => !SAME_SERIES_DIMENSIONS.includes(dimension));
  if (unknownDimension) {
    return { ok: false, reason: `unexpected_same_series_dimension:${unknownDimension}` };
  }
  if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) {
    return { ok: false, reason: 'same_series_created_at_invalid' };
  }
  return { ok: true };
}

export function classifySameSeriesObservation(value) {
  const validation = validateSameSeriesObservation(value);
  if (!validation.ok) {
    return {
      verdict: 'INVALID',
      calibrationStatus: value?.calibrationStatus ?? 'UNKNOWN',
      blockers: [validation.reason],
    };
  }
  return {
    verdict: 'UNVERIFIED',
    calibrationStatus: value.calibrationStatus,
    blockers: ['same_series_thresholds_not_calibrated'],
  };
}

export function validateHumanPairwisePreference(value) {
  if (!isObject(value)) return { ok: false, reason: 'human_preference_required' };
  if (value.schema !== 'eve-atelier-human-pairwise-preference/v1') {
    return { ok: false, reason: 'unsupported_human_preference_schema' };
  }
  if (!isNonEmptyString(value.preferenceId)) {
    return { ok: false, reason: 'human_preference_id_required' };
  }
  if (!isObject(value.scope)
      || value.scope.kind !== 'PROJECT_LOCAL'
      || !isNonEmptyString(value.scope.projectId)
      || !isNonEmptyString(value.scope.taskId)) {
    return { ok: false, reason: 'human_preference_project_local_scope_required' };
  }
  if (value.scope.universal !== undefined) {
    return { ok: false, reason: 'human_preference_universal_scope_forbidden' };
  }
  if (!isNonEmptyString(value.leftArtifactId)
      || !isNonEmptyString(value.rightArtifactId)
      || value.leftArtifactId === value.rightArtifactId) {
    return { ok: false, reason: 'human_preference_distinct_pair_required' };
  }
  if (!['LEFT', 'RIGHT', 'TIE', 'NEITHER'].includes(value.preferred)) {
    return { ok: false, reason: 'human_preference_choice_invalid' };
  }
  if (!isNonEmptyString(value.reason)) {
    return { ok: false, reason: 'human_preference_reason_required' };
  }
  if (!isNonEmptyString(value.observedAt) || Number.isNaN(Date.parse(value.observedAt))) {
    return { ok: false, reason: 'human_preference_observed_at_invalid' };
  }
  if (value.evidenceClass !== 'human_observed') {
    return { ok: false, reason: 'human_preference_evidence_class_invalid' };
  }
  return { ok: true };
}

export function createSameSeriesReview({ observation, humanPreference } = {}) {
  const observationValidation = validateSameSeriesObservation(observation);
  if (!observationValidation.ok) throw new Error(observationValidation.reason);
  const preferenceValidation = validateHumanPairwisePreference(humanPreference);
  if (!preferenceValidation.ok) throw new Error(preferenceValidation.reason);
  if (![humanPreference.leftArtifactId, humanPreference.rightArtifactId]
    .includes(observation.candidate.artifactId)) {
    throw new Error('human_preference_not_bound_to_observation_candidate');
  }

  return {
    schema: 'eve-atelier-same-series-review/v1',
    observation: structuredClone(observation),
    observationDecision: classifySameSeriesObservation(observation),
    humanPreference: structuredClone(humanPreference),
  };
}
