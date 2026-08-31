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
const styleDefinitionFields = Object.freeze(['schema', 'styleId', 'maturity', 'layers', 'constraints']);
const styleLayerFields = Object.freeze(['description', 'initialControl']);
const styleControlsByLayer = Object.freeze({
  surfaceRendering: Object.freeze([
    'lineFineness',
    'lineDensity',
    'outlineHeaviness',
    'softWash',
    'shadowSoftness',
    'specularStrength',
  ]),
  proportionSyntax: Object.freeze([
    'silhouetteElongation',
    'bodySlenderness',
    'shoulderSoftness',
    'upperBodyMass',
    'neckElegance',
    'faceRefinement',
    'handElegance',
  ]),
  garmentVolume: Object.freeze([
    'garmentFlow',
    'sleeveFlow',
    'embroideryFineness',
    'ornamentDensity',
    'hardSurfaceEmphasis',
  ]),
  compositionRhythm: Object.freeze([
    'hairFlow',
    'ribbonFlow',
    'weaponDominance',
    'backgroundMinimality',
  ]),
  paletteCompatibility: Object.freeze(['saturation', 'contrast', 'coolness']),
});
const styleReferenceFields = Object.freeze(['assetId', 'sha256', 'role', 'allowedInfluence']);
const styleConstraintInputFields = Object.freeze(['packetId', 'taskId', 'style', 'references']);
const referenceInfluenceFields = Object.freeze([
  ...referenceInfluenceDimensions,
  ...identityInfluenceDimensions,
]);
const projectLocalScopeFields = Object.freeze(['kind', 'projectId', 'taskId']);
const artifactIdentityFields = Object.freeze(['artifactId', 'sha256']);
const evaluatorFields = Object.freeze([
  'evaluatorId',
  'evaluatorVersion',
  'measurement',
  'limits',
]);
const dimensionFields = Object.freeze(['status', 'confidence', 'evidenceRefs', 'notes']);
const observationFields = Object.freeze([
  'schema',
  'observationId',
  'stylePacketId',
  'calibrationStatus',
  'scope',
  'source',
  'candidate',
  'references',
  'evaluator',
  'dimensions',
  'createdAt',
]);
const humanPreferenceFields = Object.freeze([
  'schema',
  'preferenceId',
  'scope',
  'leftArtifact',
  'rightArtifact',
  'preferred',
  'reason',
  'observedAt',
  'evidenceClass',
]);
const sameSeriesReviewInputFields = Object.freeze(['observation', 'humanPreference']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function unknownKey(value, allowedKeys) {
  return Object.keys(value).find(key => !allowedKeys.includes(key));
}

function validateStyle(style) {
  if (!isObject(style)) return 'style_definition_required';
  const unknownStyleField = unknownKey(style, styleDefinitionFields);
  if (unknownStyleField) return `style_definition_field_forbidden:${unknownStyleField}`;
  if (style.schema !== 'eve-atelier-style-definition/v1') return 'unsupported_style_definition_schema';
  if (!isNonEmptyString(style.styleId)) return 'style_id_required';
  if (style.maturity !== 'EXPERIMENTAL') return 'style_maturity_must_be_experimental';
  if (!isObject(style.layers)) return 'style_layers_required';
  const unknownLayer = unknownKey(style.layers, STYLE_CONTROL_LAYERS);
  if (unknownLayer) return `style_layer_forbidden:${unknownLayer}`;
  for (const layer of STYLE_CONTROL_LAYERS) {
    const value = style.layers[layer];
    if (!isObject(value)) return `style_layer_required:${layer}`;
    const unknownLayerField = unknownKey(value, styleLayerFields);
    if (unknownLayerField) return `style_layer_field_forbidden:${layer}:${unknownLayerField}`;
    if (!isNonEmptyString(value.description)) return `style_layer_description_required:${layer}`;
    if (!isObject(value.initialControl) || Object.keys(value.initialControl).length === 0) {
      return `style_layer_initial_control_required:${layer}`;
    }
    for (const [control, controlValue] of Object.entries(value.initialControl)) {
      if (!styleControlsByLayer[layer].includes(control)) {
        return `style_control_name_forbidden:${layer}:${control}`;
      }
      if (!Number.isFinite(controlValue) || controlValue < 0 || controlValue > 1) {
        return `style_control_value_invalid:${layer}:${control}`;
      }
    }
  }
  if (!isObject(style.constraints)) return 'style_constraints_required';
  const unknownStrength = unknownKey(style.constraints, constraintStrengths);
  if (unknownStrength) return `style_constraint_strength_forbidden:${unknownStrength}`;
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
  const unknownReferenceField = unknownKey(reference, styleReferenceFields);
  if (unknownReferenceField) return `style_reference_field_forbidden:${unknownReferenceField}`;
  if (!isNonEmptyString(reference.assetId)) return 'style_reference_asset_id_required';
  if (!isSha256(reference.sha256)) return 'style_reference_sha256_required';
  if (!isNonEmptyString(reference.role)) return 'style_reference_role_required';
  if (!isObject(reference.allowedInfluence)) return 'style_reference_influence_mask_required';
  const unknownInfluenceField = unknownKey(reference.allowedInfluence, referenceInfluenceFields);
  if (unknownInfluenceField) {
    return `style_reference_influence_field_forbidden:${unknownInfluenceField}`;
  }
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
  const unknownArtifactField = unknownKey(value, artifactIdentityFields);
  if (unknownArtifactField) return `${label}_artifact_field_forbidden:${unknownArtifactField}`;
  if (!isNonEmptyString(value.artifactId)) return `${label}_artifact_id_required`;
  if (!isSha256(value.sha256)) return `${label}_artifact_sha256_required`;
  return null;
}

function validateEvaluator(value) {
  if (!isObject(value)) return 'same_series_evaluator_required';
  const unknownEvaluatorField = unknownKey(value, evaluatorFields);
  if (unknownEvaluatorField) {
    return `same_series_evaluator_field_forbidden:${unknownEvaluatorField}`;
  }
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
  const unknownDimensionField = unknownKey(value, dimensionFields);
  if (unknownDimensionField) {
    return `same_series_dimension_field_forbidden:${dimension}:${unknownDimensionField}`;
  }
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

function validateProjectLocalScope(value, prefix) {
  if (!isObject(value)) return `${prefix}_project_local_scope_required`;
  const unknownScopeField = unknownKey(value, projectLocalScopeFields);
  if (unknownScopeField) return `${prefix}_scope_field_forbidden:${unknownScopeField}`;
  if (value.kind !== 'PROJECT_LOCAL'
      || !isNonEmptyString(value.projectId)
      || !isNonEmptyString(value.taskId)) {
    return `${prefix}_project_local_scope_required`;
  }
  return null;
}

export function compileStyleConstraintPacket(input = {}) {
  if (!isObject(input)) throw new TypeError('style_constraint_input_required');
  const unknownInputField = unknownKey(input, styleConstraintInputFields);
  if (unknownInputField) throw new Error(`style_constraint_input_field_forbidden:${unknownInputField}`);
  const { packetId, taskId, style, references } = input;
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
    controlLayers: Object.fromEntries(STYLE_CONTROL_LAYERS.map(layer => [
      layer,
      {
        description: style.layers[layer].description,
        initialControl: { ...style.layers[layer].initialControl },
      },
    ])),
    constraints: Object.fromEntries(constraintStrengths.map(strength => [
      strength,
      [...style.constraints[strength]],
    ])),
    references: references.map(reference => ({
      assetId: reference.assetId,
      sha256: reference.sha256,
      role: reference.role,
      allowedInfluence: Object.fromEntries(referenceInfluenceFields.map(field => [
        field,
        reference.allowedInfluence[field],
      ])),
    })),
  };
}

export function validateSameSeriesObservation(value) {
  if (!isObject(value)) return { ok: false, reason: 'same_series_observation_required' };
  if ('styleScore' in value) {
    return { ok: false, reason: 'same_series_scalar_score_forbidden' };
  }
  const unknownObservationField = unknownKey(value, observationFields);
  if (unknownObservationField) {
    return { ok: false, reason: `same_series_observation_field_forbidden:${unknownObservationField}` };
  }
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
  const scopeFailure = validateProjectLocalScope(value.scope, 'same_series');
  if (scopeFailure) return { ok: false, reason: scopeFailure };
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
  const unknownPreferenceField = unknownKey(value, humanPreferenceFields);
  if (unknownPreferenceField) {
    return { ok: false, reason: `human_preference_field_forbidden:${unknownPreferenceField}` };
  }
  if (value.schema !== 'eve-atelier-human-pairwise-preference/v1') {
    return { ok: false, reason: 'unsupported_human_preference_schema' };
  }
  if (!isNonEmptyString(value.preferenceId)) {
    return { ok: false, reason: 'human_preference_id_required' };
  }
  if (isObject(value.scope) && value.scope.universal !== undefined) {
    return { ok: false, reason: 'human_preference_universal_scope_forbidden' };
  }
  const scopeFailure = validateProjectLocalScope(value.scope, 'human_preference');
  if (scopeFailure) return { ok: false, reason: scopeFailure };
  const leftFailure = validateArtifactIdentity(value.leftArtifact, 'left');
  if (leftFailure) return { ok: false, reason: leftFailure };
  const rightFailure = validateArtifactIdentity(value.rightArtifact, 'right');
  if (rightFailure) return { ok: false, reason: rightFailure };
  if (value.leftArtifact.artifactId === value.rightArtifact.artifactId) {
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

export function createSameSeriesReview(input = {}) {
  if (!isObject(input)) throw new TypeError('same_series_review_input_required');
  const unknownReviewField = unknownKey(input, sameSeriesReviewInputFields);
  if (unknownReviewField) throw new Error(`same_series_review_field_forbidden:${unknownReviewField}`);
  const { observation, humanPreference } = input;
  const observationValidation = validateSameSeriesObservation(observation);
  if (!observationValidation.ok) throw new Error(observationValidation.reason);
  const preferenceValidation = validateHumanPairwisePreference(humanPreference);
  if (!preferenceValidation.ok) throw new Error(preferenceValidation.reason);
  if (humanPreference.scope.projectId !== observation.scope.projectId
      || humanPreference.scope.taskId !== observation.scope.taskId) {
    throw new Error('human_preference_scope_mismatch');
  }
  const pair = [humanPreference.leftArtifact, humanPreference.rightArtifact];
  const candidateIdMatch = pair.find(
    artifact => artifact.artifactId === observation.candidate.artifactId,
  );
  if (!candidateIdMatch) {
    throw new Error('human_preference_not_bound_to_observation_candidate');
  }
  if (candidateIdMatch.sha256.toLowerCase() !== observation.candidate.sha256.toLowerCase()) {
    throw new Error('human_preference_not_bound_to_observation_candidate_bytes');
  }

  return {
    schema: 'eve-atelier-same-series-review/v1',
    observation: structuredClone(observation),
    observationDecision: classifySameSeriesObservation(observation),
    humanPreference: structuredClone(humanPreference),
  };
}
