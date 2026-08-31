import { isCanonicalInstant } from './time.js';
import {
  isCanonicalJsonValue,
  isDenseJsonArray,
  isPlainJsonObject,
} from './json-values.js';

const packFields = Object.freeze([
  'schema', 'packId', 'version', 'description', 'axes', 'locks', 'families', 'compilerRules',
]);
const axisFields = Object.freeze(['axisId', 'description', 'valueSchema']);
const scalarSchemaFields = Object.freeze(['kind', 'min', 'max']);
const enumSchemaFields = Object.freeze(['kind', 'values']);
const vectorSchemaFields = Object.freeze(['kind', 'dimensions', 'min', 'max']);
const lockFields = Object.freeze([
  'lockId', 'description', 'targetAxisIds', 'strength', 'evidenceRequired',
]);
const familyFields = Object.freeze([
  'familyId', 'version', 'description', 'abstraction', 'variants',
]);
const variantFields = Object.freeze([
  'operatorId', 'version', 'description', 'executionMode', 'inputKinds', 'outputKinds',
  'parameterSchema', 'receiptMetadataSchema', 'effects', 'requiredLockIds', 'requiredCapabilities', 'locality',
  'determinism', 'reversibility', 'authority',
]);
const parameterFields = Object.freeze(['name', 'kind', 'required', 'min', 'max']);
const effectFields = Object.freeze(['axisId', 'mode']);
const compilerRuleFields = Object.freeze([
  'ruleId', 'version', 'sourceOperatorId', 'emitsOperatorIds',
  'requiredAxisIds', 'requiredLockIds',
]);
const packRefFields = Object.freeze(['packId', 'version', 'digest']);
const operatorRefFields = Object.freeze(['operatorId', 'version']);
const targetFields = Object.freeze(['kind', 'id']);
const axisChangeFields = Object.freeze(['axisId', 'mode', 'value']);
const requestedLockFields = Object.freeze(['lockId', 'mode']);
const directiveFields = Object.freeze([
  'schema', 'directiveId', 'packRef', 'operatorRef', 'target', 'expectedRevision',
  'axisChanges', 'locks', 'requestedAt',
]);
const providerManifestFields = Object.freeze([
  'schema', 'providerId', 'providerVersion', 'availability', 'privacy',
  'capabilities', 'operators',
]);
const providerOperatorFields = Object.freeze([
  'operatorId', 'versions', 'evidenceLevel', 'costRank', 'latencyRank',
]);
const providerPolicyFields = Object.freeze(['allowedPrivacy', 'requiredCapabilities']);
const invocationFields = Object.freeze([
  'schema', 'operationId', 'packRef', 'operatorRef', 'target', 'expectedRevision',
  'inputArtifactId', 'outputArtifactId', 'input', 'output', 'params', 'providerPolicy',
]);
const providerRefFields = Object.freeze(['providerId', 'providerVersion']);
const semanticContextFields = Object.freeze(['axisChanges', 'lockIds']);
const experienceProvenanceFields = Object.freeze(['kind', 'id']);
const experienceFields = Object.freeze([
  'schema', 'eventId', 'operationId', 'packRef', 'operatorRef', 'providerRef', 'semanticContext',
  'inputHashes', 'outputHashes', 'outcome', 'evaluationRefs', 'humanPreferenceRef',
  'evidenceClass', 'provenance', 'failureClass', 'occurredAt',
]);
const artifactEvidenceFields = Object.freeze(['artifactId', 'sha256']);
const sharedDeltaFields = Object.freeze(['axisId', 'direction', 'magnitude']);
const counterfactualInterventionFields = Object.freeze([
  'target', 'axisChanges', 'lockIds', 'minimalClosureOperatorRefs',
]);
const counterfactualPredictionFields = Object.freeze([
  'schema', 'predictionId', 'packRef', 'operatorRef', 'artifactBefore', 'intervention',
  'predictedDeltas', 'scopeRefs', 'rationaleRefs', 'alternativeRationaleRefs',
  'evidenceRefs', 'evidenceClass', 'provenance', 'recordedAt',
]);
const counterfactualObservationFields = Object.freeze([
  'schema', 'observationId', 'predictionId', 'artifactAfter', 'observedDeltas',
  'collateralDeltas', 'evaluationRefs', 'limitationRefs', 'evidenceRefs',
  'evidenceClass', 'provenance', 'recordedAt',
]);
const operatorProposalFields = Object.freeze([
  'schema', 'proposalId', 'basePackRef', 'proposedOperatorRef', 'decomposition',
  'scopeRefs', 'residualRefs', 'rationaleRefs', 'evidenceRefs', 'counterevidenceRefs',
  'provenance', 'recordedAt',
]);
const decompositionFields = Object.freeze(['kind', 'componentOperatorRefs']);

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const absoluteLocalPath = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|users|var|tmp|opt)\/)/i;
const providerParameterName = /(provider|workflow|model|prompt|backend|checkpoint|lora|cfg|denoise)/i;
const receiptMetadataReservedName = /(accept|approv|evaluat|verdict|promot|workbench|authority|credential|secret|token|password|path|provider|workflow|model|prompt|backend|checkpoint|lora|cfg|denoise)/i;

function isObject(value) {
  return isPlainJsonObject(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values, { nonEmpty = false } = {}) {
  return isDenseJsonArray(values)
    && (!nonEmpty || values.length > 0)
    && values.every(nonEmptyString)
    && new Set(values).size === values.length;
}

function unknownKey(value, allowed) {
  return Object.keys(value).find(key => !allowed.includes(key));
}

function hasUnknownKey(value, allowed) {
  return unknownKey(value, allowed) !== undefined;
}

function containsLocalPath(value) {
  if (typeof value === 'string') return absoluteLocalPath.test(value);
  if (Array.isArray(value)) return value.some(containsLocalPath);
  if (!isObject(value)) return false;
  return Object.values(value).some(containsLocalPath);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validatePackRef(value) {
  if (!isObject(value) || hasUnknownKey(value, packRefFields)) return false;
  return nonEmptyString(value.packId)
    && semverPattern.test(value.version ?? '')
    && isSha256(value.digest);
}

function validateOperatorRef(value) {
  if (!isObject(value) || hasUnknownKey(value, operatorRefFields)) return false;
  return nonEmptyString(value.operatorId)
    && value.operatorId.startsWith('visual.op.')
    && semverPattern.test(value.version ?? '');
}

function validateTarget(value) {
  return isObject(value)
    && !hasUnknownKey(value, targetFields)
    && nonEmptyString(value.kind)
    && nonEmptyString(value.id)
    && !containsLocalPath(value);
}

function validateAxisChange(value) {
  if (!isObject(value) || hasUnknownKey(value, axisChangeFields)) return false;
  if (!nonEmptyString(value.axisId)
      || !['INCREASE', 'DECREASE', 'SET'].includes(value.mode)) return false;
  if (Number.isFinite(value.value) || nonEmptyString(value.value)) return true;
  return isObject(value.value)
    && Object.keys(value.value).length > 0
    && Object.values(value.value).every(Number.isFinite);
}

function validateRequestedLock(value) {
  return isObject(value)
    && !hasUnknownKey(value, requestedLockFields)
    && nonEmptyString(value.lockId)
    && value.mode === 'PRESERVE';
}

function validateProvenance(value) {
  return isObject(value)
    && !hasUnknownKey(value, experienceProvenanceFields)
    && ['AI', 'HUMAN', 'SYSTEM'].includes(value.kind)
    && nonEmptyString(value.id);
}

function validateArtifactEvidence(value) {
  return isObject(value)
    && !hasUnknownKey(value, artifactEvidenceFields)
    && nonEmptyString(value.artifactId)
    && !containsLocalPath(value.artifactId)
    && isSha256(value.sha256);
}

function validateSharedDeltas(values, { nonEmpty = true } = {}) {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) return false;
  const axes = new Set();
  for (const value of values) {
    if (!isObject(value)
        || hasUnknownKey(value, sharedDeltaFields)
        || !nonEmptyString(value.axisId)
        || !value.axisId.startsWith('semantic.axis.')
        || !['INCREASE', 'DECREASE', 'STABLE', 'UNKNOWN'].includes(value.direction)
        || !['SMALL', 'MEDIUM', 'LARGE', 'UNKNOWN'].includes(value.magnitude)
        || axes.has(value.axisId)) {
      return false;
    }
    axes.add(value.axisId);
  }
  return true;
}

function validateCounterfactualIntervention(value) {
  return isObject(value)
    && !hasUnknownKey(value, counterfactualInterventionFields)
    && validateTarget(value.target)
    && Array.isArray(value.axisChanges)
    && value.axisChanges.length > 0
    && value.axisChanges.every(validateAxisChange)
    && uniqueStrings(value.lockIds)
    && Array.isArray(value.minimalClosureOperatorRefs)
    && value.minimalClosureOperatorRefs.length > 0
    && value.minimalClosureOperatorRefs.every(validateOperatorRef)
    && new Set(value.minimalClosureOperatorRefs.map(ref => `${ref.operatorId}@${ref.version}`)).size
      === value.minimalClosureOperatorRefs.length;
}

function validateValueSchema(value) {
  if (!isObject(value)) return false;
  if (value.kind === 'SCALAR') {
    return !hasUnknownKey(value, scalarSchemaFields)
      && Number.isFinite(value.min)
      && Number.isFinite(value.max)
      && value.min < value.max;
  }
  if (value.kind === 'ENUM') {
    return !hasUnknownKey(value, enumSchemaFields) && uniqueStrings(value.values, { nonEmpty: true });
  }
  if (value.kind === 'VECTOR') {
    return !hasUnknownKey(value, vectorSchemaFields)
      && uniqueStrings(value.dimensions, { nonEmpty: true })
      && Number.isFinite(value.min)
      && Number.isFinite(value.max)
      && value.min < value.max;
  }
  return false;
}

function validateAxis(axis) {
  if (!isObject(axis)) return 'axis_must_be_object';
  const extra = unknownKey(axis, axisFields);
  if (extra !== undefined) return `axis_field_forbidden:${extra}`;
  if (!nonEmptyString(axis.axisId) || !axis.axisId.startsWith('semantic.axis.')) {
    return 'axis_id_must_be_semantic_namespace';
  }
  if (!nonEmptyString(axis.description)) return `axis_description_required:${axis.axisId}`;
  if (!validateValueSchema(axis.valueSchema)) return `invalid_axis_value_schema:${axis.axisId}`;
  return null;
}

function validateLock(lock, axisIds) {
  if (!isObject(lock)) return 'lock_must_be_object';
  const extra = unknownKey(lock, lockFields);
  if (extra !== undefined) return `lock_field_forbidden:${extra}`;
  if (!nonEmptyString(lock.lockId) || !lock.lockId.startsWith('semantic.lock.')) {
    return 'lock_id_must_be_semantic_namespace';
  }
  if (!nonEmptyString(lock.description)) return `lock_description_required:${lock.lockId}`;
  if (!uniqueStrings(lock.targetAxisIds, { nonEmpty: true })) {
    return `lock_target_axes_required:${lock.lockId}`;
  }
  const unknownAxis = lock.targetAxisIds.find(axisId => !axisIds.has(axisId));
  if (unknownAxis) return `unknown_lock_axis:${unknownAxis}`;
  if (!['HARD', 'STRONG', 'MEDIUM', 'SOFT'].includes(lock.strength)) {
    return `invalid_lock_strength:${lock.lockId}`;
  }
  if (typeof lock.evidenceRequired !== 'boolean') {
    return `lock_evidence_requirement_invalid:${lock.lockId}`;
  }
  return null;
}

function validateParameter(parameter, operatorId) {
  if (!isObject(parameter)) return `operator_parameter_must_be_object:${operatorId}`;
  const extra = unknownKey(parameter, parameterFields);
  if (extra !== undefined) return `operator_parameter_field_forbidden:${operatorId}:${extra}`;
  if (!nonEmptyString(parameter.name)) return `operator_parameter_name_required:${operatorId}`;
  if (providerParameterName.test(parameter.name)) {
    return `operator_parameter_name_forbidden:${operatorId}:${parameter.name}`;
  }
  if (!['INTEGER', 'NUMBER', 'STRING', 'BOOLEAN', 'NUMBER_ARRAY'].includes(parameter.kind)) {
    return `operator_parameter_kind_invalid:${operatorId}:${parameter.name}`;
  }
  if (typeof parameter.required !== 'boolean') {
    return `operator_parameter_required_flag_invalid:${operatorId}:${parameter.name}`;
  }
  const hasBounds = parameter.min !== undefined || parameter.max !== undefined;
  if (hasBounds) {
    if (!['INTEGER', 'NUMBER', 'NUMBER_ARRAY'].includes(parameter.kind)
        || !Number.isFinite(parameter.min)
        || !Number.isFinite(parameter.max)
        || parameter.min > parameter.max) {
      return `operator_parameter_bounds_invalid:${operatorId}:${parameter.name}`;
    }
  }
  return null;
}

function validateEffect(effect, axisIds) {
  if (!isObject(effect)) return 'operator_effect_must_be_object';
  const extra = unknownKey(effect, effectFields);
  if (extra !== undefined) return `operator_effect_field_forbidden:${extra}`;
  if (!axisIds.has(effect.axisId)) return `unknown_operator_effect_axis:${effect.axisId ?? ''}`;
  if (!['INCREASE', 'DECREASE', 'SET', 'PRESERVE', 'OBSERVE'].includes(effect.mode)) {
    return `operator_effect_mode_invalid:${effect.axisId}`;
  }
  return null;
}

function validateVariant(variant, axisIds, lockIds) {
  if (!isObject(variant)) return 'operator_variant_must_be_object';
  const extra = unknownKey(variant, variantFields);
  if (extra !== undefined) return `operator_variant_field_forbidden:${extra}`;
  if (!nonEmptyString(variant.operatorId) || !variant.operatorId.startsWith('visual.op.')) {
    return 'operator_id_must_be_visual_namespace';
  }
  if (!semverPattern.test(variant.version ?? '')) {
    return `operator_version_invalid:${variant.operatorId}`;
  }
  if (!nonEmptyString(variant.description)) return `operator_description_required:${variant.operatorId}`;
  if (!['COMPILE_ONLY', 'PROVIDER_BOUND'].includes(variant.executionMode)) {
    return `operator_execution_mode_invalid:${variant.operatorId}`;
  }
  if (!uniqueStrings(variant.inputKinds, { nonEmpty: true })
      || !uniqueStrings(variant.outputKinds, { nonEmpty: true })) {
    return `operator_input_output_kinds_invalid:${variant.operatorId}`;
  }
  if (!Array.isArray(variant.parameterSchema)) return `operator_parameter_schema_required:${variant.operatorId}`;
  const parameterNames = new Set();
  for (const parameter of variant.parameterSchema) {
    const failure = validateParameter(parameter, variant.operatorId);
    if (failure) return failure;
    if (parameterNames.has(parameter.name)) {
      return `duplicate_operator_parameter:${variant.operatorId}:${parameter.name}`;
    }
    parameterNames.add(parameter.name);
  }
  if (!Array.isArray(variant.receiptMetadataSchema)) {
    return `operator_receipt_metadata_schema_required:${variant.operatorId}`;
  }
  const metadataNames = new Set();
  for (const metadata of variant.receiptMetadataSchema) {
    if (receiptMetadataReservedName.test(metadata?.name ?? '')) {
      return `operator_receipt_metadata_name_forbidden:${variant.operatorId}:${metadata?.name ?? ''}`;
    }
    const failure = validateParameter(metadata, variant.operatorId);
    if (failure) return failure.replace('operator_parameter', 'operator_receipt_metadata');
    if (metadataNames.has(metadata.name)) {
      return `duplicate_operator_receipt_metadata:${variant.operatorId}:${metadata.name}`;
    }
    metadataNames.add(metadata.name);
  }
  if (!Array.isArray(variant.effects)) return `operator_effects_required:${variant.operatorId}`;
  for (const effect of variant.effects) {
    const failure = validateEffect(effect, axisIds);
    if (failure) return failure;
  }
  if (!uniqueStrings(variant.requiredLockIds) || !uniqueStrings(variant.requiredCapabilities)) {
    return `operator_requirements_invalid:${variant.operatorId}`;
  }
  const unknownLock = variant.requiredLockIds.find(lockId => !lockIds.has(lockId));
  if (unknownLock) return `unknown_operator_lock:${unknownLock}`;
  if (!['GLOBAL', 'REGIONAL', 'POINT', 'NONE'].includes(variant.locality)) {
    return `operator_locality_invalid:${variant.operatorId}`;
  }
  if (!['DETERMINISTIC', 'SEEDED_STOCHASTIC', 'NONDETERMINISTIC'].includes(variant.determinism)) {
    return `operator_determinism_invalid:${variant.operatorId}`;
  }
  if (!['REVERSIBLE', 'COMPENSATABLE', 'IRREVERSIBLE'].includes(variant.reversibility)) {
    return `operator_reversibility_invalid:${variant.operatorId}`;
  }
  if (!['CANDIDATE_ONLY', 'OBSERVATION_ONLY'].includes(variant.authority)) {
    return `operator_authority_forbidden:${variant.operatorId}`;
  }
  return null;
}

function validateFamily(family, axisIds, lockIds) {
  if (!isObject(family)) return 'operator_family_must_be_object';
  const extra = unknownKey(family, familyFields);
  if (extra !== undefined) return `operator_family_field_forbidden:${extra}`;
  if (!nonEmptyString(family.familyId) || !family.familyId.startsWith('visual.family.')) {
    return 'operator_family_id_must_be_visual_namespace';
  }
  if (!semverPattern.test(family.version ?? '')) return `operator_family_version_invalid:${family.familyId}`;
  if (!nonEmptyString(family.description)) return `operator_family_description_required:${family.familyId}`;
  if (!['SEMANTIC', 'EXECUTABLE', 'EVALUATION', 'GOVERNANCE'].includes(family.abstraction)) {
    return `operator_family_abstraction_invalid:${family.familyId}`;
  }
  if (!Array.isArray(family.variants) || family.variants.length === 0) {
    return `operator_family_variants_required:${family.familyId}`;
  }
  for (const variant of family.variants) {
    const failure = validateVariant(variant, axisIds, lockIds);
    if (failure) return failure;
  }
  return null;
}

function validateCompilerRule(rule, axes, locks, operators) {
  if (!isObject(rule)) return 'compiler_rule_must_be_object';
  const extra = unknownKey(rule, compilerRuleFields);
  if (extra !== undefined) return `compiler_rule_field_forbidden:${extra}`;
  if (!nonEmptyString(rule.ruleId) || !rule.ruleId.startsWith('compiler.rule.')) {
    return 'compiler_rule_id_must_be_compiler_namespace';
  }
  if (!semverPattern.test(rule.version ?? '')) return `compiler_rule_version_invalid:${rule.ruleId}`;
  if (!operators.has(rule.sourceOperatorId)) {
    return `unknown_compiler_source_operator:${rule.sourceOperatorId ?? ''}`;
  }
  if (operators.get(rule.sourceOperatorId).executionMode !== 'COMPILE_ONLY') {
    return `compiler_source_must_be_compile_only:${rule.sourceOperatorId}`;
  }
  if (!uniqueStrings(rule.emitsOperatorIds, { nonEmpty: true })
      || !uniqueStrings(rule.requiredAxisIds)
      || !uniqueStrings(rule.requiredLockIds)) {
    return `compiler_rule_references_invalid:${rule.ruleId}`;
  }
  const missingOutput = rule.emitsOperatorIds.find(operatorId => !operators.has(operatorId));
  if (missingOutput) return `unknown_compiler_output_operator:${missingOutput}`;
  const compileOnlyOutput = rule.emitsOperatorIds.find(
    operatorId => operators.get(operatorId).executionMode !== 'PROVIDER_BOUND',
  );
  if (compileOnlyOutput) return `compiler_output_must_be_provider_bound:${compileOnlyOutput}`;
  const missingAxis = rule.requiredAxisIds.find(axisId => !axes.has(axisId));
  if (missingAxis) return `unknown_compiler_axis:${missingAxis}`;
  const missingLock = rule.requiredLockIds.find(lockId => !locks.has(lockId));
  if (missingLock) return `unknown_compiler_lock:${missingLock}`;
  return null;
}

export function validateOperatorPack(value) {
  if (!isObject(value)) return { ok: false, reason: 'operator_pack_required' };
  if (!isCanonicalJsonValue(value)) return { ok: false, reason: 'operator_pack_json_value_invalid' };
  const extra = unknownKey(value, packFields);
  if (extra !== undefined) return { ok: false, reason: `operator_pack_field_forbidden:${extra}` };
  if (containsLocalPath(value)) return { ok: false, reason: 'operator_pack_local_path_forbidden' };
  if (value.schema !== 'eve-atelier-operator-pack/v1') {
    return { ok: false, reason: 'unsupported_operator_pack_schema' };
  }
  if (!nonEmptyString(value.packId)) return { ok: false, reason: 'operator_pack_id_required' };
  if (!semverPattern.test(value.version ?? '')) return { ok: false, reason: 'operator_pack_version_invalid' };
  if (!nonEmptyString(value.description)) return { ok: false, reason: 'operator_pack_description_required' };
  if (!Array.isArray(value.axes)
      || !Array.isArray(value.locks)
      || !Array.isArray(value.families)
      || value.families.length === 0
      || !Array.isArray(value.compilerRules)) {
    return { ok: false, reason: 'operator_pack_collections_required' };
  }

  const axisIds = new Set();
  for (const axis of value.axes) {
    const failure = validateAxis(axis);
    if (failure) return { ok: false, reason: failure };
    if (axisIds.has(axis.axisId)) return { ok: false, reason: `duplicate_axis_id:${axis.axisId}` };
    axisIds.add(axis.axisId);
  }

  const lockIds = new Set();
  for (const lock of value.locks) {
    const failure = validateLock(lock, axisIds);
    if (failure) return { ok: false, reason: failure };
    if (lockIds.has(lock.lockId)) return { ok: false, reason: `duplicate_lock_id:${lock.lockId}` };
    lockIds.add(lock.lockId);
  }

  const operatorRefs = new Set();
  const operators = new Map();
  const familyRefs = new Set();
  for (const family of value.families) {
    const failure = validateFamily(family, axisIds, lockIds);
    if (failure) return { ok: false, reason: failure };
    const familyRef = `${family.familyId}@${family.version}`;
    if (familyRefs.has(familyRef)) return { ok: false, reason: `duplicate_operator_family:${familyRef}` };
    familyRefs.add(familyRef);
    for (const variant of family.variants) {
      const operatorRef = `${variant.operatorId}@${variant.version}`;
      if (operatorRefs.has(operatorRef) || operators.has(variant.operatorId)) {
        return { ok: false, reason: `duplicate_operator_version:${operatorRef}` };
      }
      operatorRefs.add(operatorRef);
      operators.set(variant.operatorId, variant);
    }
  }

  const ruleRefs = new Set();
  const compilerSources = new Set();
  for (const rule of value.compilerRules) {
    const failure = validateCompilerRule(rule, axisIds, lockIds, operators);
    if (failure) return { ok: false, reason: failure };
    const ruleRef = `${rule.ruleId}@${rule.version}`;
    if (ruleRefs.has(ruleRef)) return { ok: false, reason: `duplicate_compiler_rule:${ruleRef}` };
    if (compilerSources.has(rule.sourceOperatorId)) {
      return { ok: false, reason: `duplicate_compiler_source_operator:${rule.sourceOperatorId}` };
    }
    ruleRefs.add(ruleRef);
    compilerSources.add(rule.sourceOperatorId);
  }
  return { ok: true };
}

export function validateSemanticDirective(value) {
  if (!isObject(value)) return { ok: false, reason: 'semantic_directive_required' };
  if (!isCanonicalJsonValue(value)) return { ok: false, reason: 'semantic_directive_json_value_invalid' };
  const extra = unknownKey(value, directiveFields);
  if (extra !== undefined) return { ok: false, reason: `semantic_directive_field_forbidden:${extra}` };
  if (value.schema !== 'eve-atelier-semantic-directive/v1') {
    return { ok: false, reason: 'unsupported_semantic_directive_schema' };
  }
  if (!nonEmptyString(value.directiveId)) return { ok: false, reason: 'semantic_directive_id_required' };
  if (!validatePackRef(value.packRef)) return { ok: false, reason: 'semantic_directive_pack_ref_invalid' };
  if (!validateOperatorRef(value.operatorRef)) return { ok: false, reason: 'semantic_directive_operator_ref_invalid' };
  if (!validateTarget(value.target)) return { ok: false, reason: 'semantic_directive_target_invalid' };
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) {
    return { ok: false, reason: 'semantic_directive_expected_revision_invalid' };
  }
  if (!Array.isArray(value.axisChanges)
      || value.axisChanges.length === 0
      || value.axisChanges.some(change => !validateAxisChange(change))) {
    return { ok: false, reason: 'semantic_directive_axis_changes_invalid' };
  }
  if (!Array.isArray(value.locks) || value.locks.some(lock => !validateRequestedLock(lock))) {
    return { ok: false, reason: 'semantic_directive_locks_invalid' };
  }
  if (!isCanonicalInstant(value.requestedAt)) return { ok: false, reason: 'semantic_directive_requested_at_invalid' };
  return { ok: true };
}

export function validateProviderCapabilityManifest(value) {
  if (!isObject(value)) return { ok: false, reason: 'provider_capability_manifest_required' };
  if (!isCanonicalJsonValue(value)) return { ok: false, reason: 'provider_manifest_json_value_invalid' };
  const extra = unknownKey(value, providerManifestFields);
  if (extra !== undefined) return { ok: false, reason: `provider_manifest_field_forbidden:${extra}` };
  if (containsLocalPath(value)) return { ok: false, reason: 'provider_manifest_local_path_forbidden' };
  if (value.schema !== 'eve-atelier-provider-capability/v1') {
    return { ok: false, reason: 'unsupported_provider_capability_schema' };
  }
  if (!nonEmptyString(value.providerId) || !nonEmptyString(value.providerVersion)) {
    return { ok: false, reason: 'provider_identity_required' };
  }
  if (!['AVAILABLE', 'UNAVAILABLE'].includes(value.availability)) {
    return { ok: false, reason: 'provider_availability_invalid' };
  }
  if (!['LOCAL', 'REMOTE_PRIVATE', 'REMOTE_PUBLIC'].includes(value.privacy)) {
    return { ok: false, reason: 'provider_privacy_invalid' };
  }
  if (!uniqueStrings(value.capabilities) || !Array.isArray(value.operators) || value.operators.length === 0) {
    return { ok: false, reason: 'provider_capabilities_required' };
  }
  const operatorIds = new Set();
  for (const operator of value.operators) {
    if (!isObject(operator)) return { ok: false, reason: 'provider_operator_must_be_object' };
    const operatorExtra = unknownKey(operator, providerOperatorFields);
    if (operatorExtra !== undefined) return { ok: false, reason: `provider_operator_field_forbidden:${operatorExtra}` };
    if (!nonEmptyString(operator.operatorId)
        || !operator.operatorId.startsWith('visual.op.')
        || !uniqueStrings(operator.versions, { nonEmpty: true })
        || operator.versions.some(version => !semverPattern.test(version))) {
      return { ok: false, reason: 'provider_operator_identity_invalid' };
    }
    if (operatorIds.has(operator.operatorId)) {
      return { ok: false, reason: `duplicate_provider_operator:${operator.operatorId}` };
    }
    operatorIds.add(operator.operatorId);
    if (!['PRODUCTION_OBSERVED', 'RIGHTS_CLEAR_REAL', 'PRIVATE_RESEARCH_AUTHORIZED', 'CONTRACT_TESTED', 'FIXTURE'].includes(operator.evidenceLevel)) {
      return { ok: false, reason: `provider_operator_evidence_invalid:${operator.operatorId}` };
    }
    if (!Number.isFinite(operator.costRank)
        || operator.costRank < 0
        || !Number.isFinite(operator.latencyRank)
        || operator.latencyRank < 0) {
      return { ok: false, reason: `provider_operator_rank_invalid:${operator.operatorId}` };
    }
  }
  return { ok: true };
}

export function validateOperatorInvocation(value) {
  if (!isObject(value)) return { ok: false, reason: 'operator_invocation_required' };
  if (!isCanonicalJsonValue(value)) return { ok: false, reason: 'operator_invocation_json_value_invalid' };
  const extra = unknownKey(value, invocationFields);
  if (extra !== undefined) return { ok: false, reason: `operator_invocation_field_forbidden:${extra}` };
  if (value.schema !== 'eve-atelier-operator-invocation/v1') {
    return { ok: false, reason: 'unsupported_operator_invocation_schema' };
  }
  if (!nonEmptyString(value.operationId)) return { ok: false, reason: 'operator_invocation_operation_id_required' };
  if (!validatePackRef(value.packRef)) return { ok: false, reason: 'operator_invocation_pack_ref_invalid' };
  if (!validateOperatorRef(value.operatorRef)) return { ok: false, reason: 'operator_invocation_operator_ref_invalid' };
  if (!validateTarget(value.target)) return { ok: false, reason: 'operator_invocation_target_invalid' };
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) {
    return { ok: false, reason: 'operator_invocation_expected_revision_invalid' };
  }
  if (!nonEmptyString(value.inputArtifactId)
      || !nonEmptyString(value.outputArtifactId)
      || value.inputArtifactId === value.outputArtifactId
      || containsLocalPath([value.inputArtifactId, value.outputArtifactId])) {
    return { ok: false, reason: 'operator_invocation_artifact_id_invalid' };
  }
  if (!nonEmptyString(value.input)
      || !nonEmptyString(value.output)
      || !isObject(value.params)) {
    return { ok: false, reason: 'operator_invocation_io_params_invalid' };
  }
  if (!isObject(value.providerPolicy)) return { ok: false, reason: 'operator_invocation_provider_policy_required' };
  const policyExtra = unknownKey(value.providerPolicy, providerPolicyFields);
  if (policyExtra !== undefined) return { ok: false, reason: `provider_policy_field_forbidden:${policyExtra}` };
  if (!uniqueStrings(value.providerPolicy.allowedPrivacy, { nonEmpty: true })
      || value.providerPolicy.allowedPrivacy.some(privacy => !['LOCAL', 'REMOTE_PRIVATE', 'REMOTE_PUBLIC'].includes(privacy))
      || !uniqueStrings(value.providerPolicy.requiredCapabilities)) {
    return { ok: false, reason: 'operator_invocation_provider_policy_invalid' };
  }
  return { ok: true };
}

export function validateExperienceEvent(value) {
  if (!isObject(value)) return { ok: false, reason: 'operator_experience_required' };
  if (!isCanonicalJsonValue(value)) return { ok: false, reason: 'operator_experience_json_value_invalid' };
  const extra = unknownKey(value, experienceFields);
  if (extra !== undefined) return { ok: false, reason: `operator_experience_field_forbidden:${extra}` };
  if (value.schema !== 'eve-atelier-operator-experience-event/v1') {
    return { ok: false, reason: 'unsupported_operator_experience_schema' };
  }
  if (!nonEmptyString(value.eventId) || !nonEmptyString(value.operationId)) {
    return { ok: false, reason: 'operator_experience_identity_required' };
  }
  if (!validatePackRef(value.packRef)) return { ok: false, reason: 'operator_experience_pack_ref_invalid' };
  if (!validateOperatorRef(value.operatorRef)) return { ok: false, reason: 'operator_experience_operator_ref_invalid' };
  if (value.providerRef !== undefined) {
    if (!isObject(value.providerRef)
        || hasUnknownKey(value.providerRef, providerRefFields)
        || !nonEmptyString(value.providerRef.providerId)
        || !nonEmptyString(value.providerRef.providerVersion)) {
      return { ok: false, reason: 'operator_experience_provider_ref_invalid' };
    }
  }
  if (!isObject(value.semanticContext)
      || hasUnknownKey(value.semanticContext, semanticContextFields)
      || !Array.isArray(value.semanticContext.axisChanges)
      || value.semanticContext.axisChanges.some(change => !validateAxisChange(change))
      || !uniqueStrings(value.semanticContext.lockIds)) {
    return { ok: false, reason: 'operator_experience_semantic_context_invalid' };
  }
  if (!Array.isArray(value.inputHashes)
      || value.inputHashes.length === 0
      || value.inputHashes.some(hash => !isSha256(hash))
      || !Array.isArray(value.outputHashes)
      || value.outputHashes.some(hash => !isSha256(hash))) {
    return { ok: false, reason: 'operator_experience_artifact_hashes_invalid' };
  }
  if (!['PREPARED', 'COMPLETED', 'FAILED', 'UNVERIFIED'].includes(value.outcome)) {
    return { ok: false, reason: 'operator_experience_outcome_invalid' };
  }
  if (value.outcome === 'COMPLETED' && value.outputHashes.length === 0) {
    return { ok: false, reason: 'operator_experience_completed_output_required' };
  }
  if (value.outcome === 'FAILED') {
    if (!nonEmptyString(value.failureClass)) {
      return { ok: false, reason: 'operator_experience_failure_class_required' };
    }
  } else if (value.failureClass !== undefined) {
    return { ok: false, reason: 'operator_experience_failure_class_forbidden' };
  }
  if (!uniqueStrings(value.evaluationRefs)
      || (value.humanPreferenceRef !== undefined && !nonEmptyString(value.humanPreferenceRef))) {
    return { ok: false, reason: 'operator_experience_evidence_refs_invalid' };
  }
  if (!['PRODUCTION_OBSERVED', 'RIGHTS_CLEAR_REAL', 'PRIVATE_RESEARCH_AUTHORIZED', 'HUMAN_OBSERVED', 'CONTRACT_TESTED', 'FIXTURE'].includes(value.evidenceClass)) {
    return { ok: false, reason: 'operator_experience_evidence_class_invalid' };
  }
  if (!isObject(value.provenance)
      || hasUnknownKey(value.provenance, experienceProvenanceFields)
      || !['RUNTIME', 'AI', 'HUMAN', 'SYSTEM'].includes(value.provenance.kind)
      || !nonEmptyString(value.provenance.id)) {
    return { ok: false, reason: 'operator_experience_provenance_invalid' };
  }
  const allowedEvidence = {
    RUNTIME: ['CONTRACT_TESTED'],
    AI: ['FIXTURE', 'CONTRACT_TESTED'],
    HUMAN: ['FIXTURE', 'CONTRACT_TESTED', 'HUMAN_OBSERVED'],
    SYSTEM: ['FIXTURE', 'CONTRACT_TESTED'],
  };
  if (!allowedEvidence[value.provenance.kind].includes(value.evidenceClass)) {
    return { ok: false, reason: `operator_experience_evidence_overclaim:${value.provenance.kind}` };
  }
  if (!isCanonicalInstant(value.occurredAt)) return { ok: false, reason: 'operator_experience_occurred_at_invalid' };
  return { ok: true };
}

export function validateCounterfactualPrediction(value) {
  if (!isObject(value)) return { ok: false, reason: 'counterfactual_prediction_required' };
  if (!isCanonicalJsonValue(value)) {
    return { ok: false, reason: 'counterfactual_prediction_json_value_invalid' };
  }
  const extra = unknownKey(value, counterfactualPredictionFields);
  if (extra !== undefined) return { ok: false, reason: `counterfactual_prediction_field_forbidden:${extra}` };
  if (containsLocalPath(value)) {
    return { ok: false, reason: 'counterfactual_prediction_local_path_forbidden' };
  }
  if (value.schema !== 'eve-atelier-visual-counterfactual-prediction/v1') {
    return { ok: false, reason: 'unsupported_counterfactual_prediction_schema' };
  }
  if (!nonEmptyString(value.predictionId)) {
    return { ok: false, reason: 'counterfactual_prediction_id_required' };
  }
  if (!validatePackRef(value.packRef)) {
    return { ok: false, reason: 'counterfactual_prediction_pack_ref_invalid' };
  }
  if (!validateOperatorRef(value.operatorRef)) {
    return { ok: false, reason: 'counterfactual_prediction_operator_ref_invalid' };
  }
  if (!validateArtifactEvidence(value.artifactBefore)) {
    return { ok: false, reason: 'counterfactual_prediction_artifact_invalid' };
  }
  if (!validateCounterfactualIntervention(value.intervention)) {
    return { ok: false, reason: 'counterfactual_prediction_intervention_invalid' };
  }
  if (!validateSharedDeltas(value.predictedDeltas)) {
    return { ok: false, reason: 'counterfactual_prediction_deltas_invalid' };
  }
  if (!uniqueStrings(value.scopeRefs, { nonEmpty: true })
      || !uniqueStrings(value.rationaleRefs, { nonEmpty: true })
      || !uniqueStrings(value.alternativeRationaleRefs)
      || !uniqueStrings(value.evidenceRefs, { nonEmpty: true })) {
    return { ok: false, reason: 'counterfactual_prediction_references_invalid' };
  }
  if (!['MODEL_INFERENCE', 'HUMAN_ANALYST_INFERENCE', 'DOCUMENTED_CREATOR_RATIONALE', 'FIXTURE', 'CONTRACT_TESTED'].includes(value.evidenceClass)) {
    return { ok: false, reason: 'counterfactual_prediction_evidence_class_invalid' };
  }
  if (!validateProvenance(value.provenance)) {
    return { ok: false, reason: 'counterfactual_prediction_provenance_invalid' };
  }
  const allowedEvidence = {
    AI: ['MODEL_INFERENCE', 'FIXTURE', 'CONTRACT_TESTED'],
    HUMAN: ['HUMAN_ANALYST_INFERENCE', 'DOCUMENTED_CREATOR_RATIONALE', 'FIXTURE', 'CONTRACT_TESTED'],
    SYSTEM: ['FIXTURE', 'CONTRACT_TESTED'],
  };
  if (!allowedEvidence[value.provenance.kind].includes(value.evidenceClass)) {
    return {
      ok: false,
      reason: `counterfactual_prediction_evidence_overclaim:${value.provenance.kind}`,
    };
  }
  if (!isCanonicalInstant(value.recordedAt)) {
    return { ok: false, reason: 'counterfactual_prediction_recorded_at_invalid' };
  }
  return { ok: true };
}

export function validateCounterfactualObservation(value) {
  if (!isObject(value)) return { ok: false, reason: 'counterfactual_observation_required' };
  if (!isCanonicalJsonValue(value)) {
    return { ok: false, reason: 'counterfactual_observation_json_value_invalid' };
  }
  const extra = unknownKey(value, counterfactualObservationFields);
  if (extra !== undefined) return { ok: false, reason: `counterfactual_observation_field_forbidden:${extra}` };
  if (containsLocalPath(value)) {
    return { ok: false, reason: 'counterfactual_observation_local_path_forbidden' };
  }
  if (value.schema !== 'eve-atelier-visual-counterfactual-observation/v1') {
    return { ok: false, reason: 'unsupported_counterfactual_observation_schema' };
  }
  if (!nonEmptyString(value.observationId) || !nonEmptyString(value.predictionId)) {
    return { ok: false, reason: 'counterfactual_observation_identity_required' };
  }
  if (!validateArtifactEvidence(value.artifactAfter)) {
    return { ok: false, reason: 'counterfactual_observation_artifact_invalid' };
  }
  if (!validateSharedDeltas(value.observedDeltas)
      || !validateSharedDeltas(value.collateralDeltas, { nonEmpty: false })) {
    return { ok: false, reason: 'counterfactual_observation_deltas_invalid' };
  }
  const observedAxes = new Set(value.observedDeltas.map(delta => delta.axisId));
  if (value.collateralDeltas.some(delta => observedAxes.has(delta.axisId))) {
    return { ok: false, reason: 'counterfactual_observation_collateral_overlap' };
  }
  if (!uniqueStrings(value.evaluationRefs, { nonEmpty: true })
      || !uniqueStrings(value.limitationRefs)
      || !uniqueStrings(value.evidenceRefs, { nonEmpty: true })) {
    return { ok: false, reason: 'counterfactual_observation_references_invalid' };
  }
  if (!['MODEL_OBSERVATION', 'HUMAN_OBSERVATION', 'GENERATED_VARIANT', 'MANUAL_EDIT', 'CONTROLLED_EXPERIMENT', 'FIXTURE', 'CONTRACT_TESTED'].includes(value.evidenceClass)) {
    return { ok: false, reason: 'counterfactual_observation_evidence_class_invalid' };
  }
  if (!validateProvenance(value.provenance)) {
    return { ok: false, reason: 'counterfactual_observation_provenance_invalid' };
  }
  const allowedEvidence = {
    AI: ['MODEL_OBSERVATION', 'FIXTURE', 'CONTRACT_TESTED'],
    HUMAN: ['HUMAN_OBSERVATION', 'MANUAL_EDIT', 'CONTROLLED_EXPERIMENT', 'FIXTURE', 'CONTRACT_TESTED'],
    SYSTEM: ['GENERATED_VARIANT', 'CONTROLLED_EXPERIMENT', 'FIXTURE', 'CONTRACT_TESTED'],
  };
  if (!allowedEvidence[value.provenance.kind].includes(value.evidenceClass)) {
    return {
      ok: false,
      reason: `counterfactual_observation_evidence_overclaim:${value.provenance.kind}`,
    };
  }
  if (!isCanonicalInstant(value.recordedAt)) {
    return { ok: false, reason: 'counterfactual_observation_recorded_at_invalid' };
  }
  return { ok: true };
}

export function validateOperatorProposal(value) {
  if (!isObject(value)) return { ok: false, reason: 'operator_proposal_required' };
  if (!isCanonicalJsonValue(value)) return { ok: false, reason: 'operator_proposal_json_value_invalid' };
  const extra = unknownKey(value, operatorProposalFields);
  if (extra !== undefined) return { ok: false, reason: `operator_proposal_field_forbidden:${extra}` };
  if (containsLocalPath(value)) return { ok: false, reason: 'operator_proposal_local_path_forbidden' };
  if (value.schema !== 'eve-atelier-operator-proposal/v1') {
    return { ok: false, reason: 'unsupported_operator_proposal_schema' };
  }
  if (!nonEmptyString(value.proposalId)) return { ok: false, reason: 'operator_proposal_id_required' };
  if (!validatePackRef(value.basePackRef)) return { ok: false, reason: 'operator_proposal_pack_ref_invalid' };
  if (!validateOperatorRef(value.proposedOperatorRef)) {
    return { ok: false, reason: 'operator_proposal_operator_ref_invalid' };
  }
  if (!isObject(value.decomposition) || hasUnknownKey(value.decomposition, decompositionFields)
      || !['COMPOSITE', 'PRIMITIVE_CANDIDATE'].includes(value.decomposition.kind)
      || !Array.isArray(value.decomposition.componentOperatorRefs)
      || value.decomposition.componentOperatorRefs.some(ref => !validateOperatorRef(ref))) {
    return { ok: false, reason: 'operator_proposal_decomposition_invalid' };
  }
  const componentKeys = value.decomposition.componentOperatorRefs
    .map(ref => `${ref.operatorId}@${ref.version}`);
  if (new Set(componentKeys).size !== componentKeys.length) {
    return { ok: false, reason: 'operator_proposal_component_duplicate' };
  }
  if (value.decomposition.kind === 'COMPOSITE' && componentKeys.length === 0) {
    return { ok: false, reason: 'operator_proposal_composite_components_required' };
  }
  if (value.decomposition.kind === 'PRIMITIVE_CANDIDATE' && componentKeys.length > 0) {
    return { ok: false, reason: 'operator_proposal_primitive_components_forbidden' };
  }
  if (!uniqueStrings(value.scopeRefs, { nonEmpty: true })
      || !uniqueStrings(value.residualRefs, { nonEmpty: true })
      || !uniqueStrings(value.rationaleRefs, { nonEmpty: true })
      || !uniqueStrings(value.evidenceRefs, { nonEmpty: true })
      || !uniqueStrings(value.counterevidenceRefs)) {
    return { ok: false, reason: 'operator_proposal_references_invalid' };
  }
  if (!validateProvenance(value.provenance)) {
    return { ok: false, reason: 'operator_proposal_provenance_invalid' };
  }
  if (!isCanonicalInstant(value.recordedAt)) {
    return { ok: false, reason: 'operator_proposal_recorded_at_invalid' };
  }
  return { ok: true };
}
