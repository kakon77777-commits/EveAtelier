import {
  isDenseJsonArray,
  isPlainJsonObject,
  normalizeCanonicalJsonValue,
} from '../operator-runtime/json-values.js';
import { canonicalJson } from '../operator-runtime/canonical.js';
import { isCanonicalInstant } from '../operator-runtime/time.js';
import { validateArtActor, validateAssetRef } from '../art-domain/contracts.js';

export const KNOWLEDGE_RECORD_KINDS = Object.freeze([
  'SOURCE_IDENTITY',
  'REFERENCE_ASSET',
  'REFERENCE_ROLE',
  'VISUAL_CONCEPT',
  'STYLE_OBSERVATION',
  'PREFERENCE_EVENT',
  'ARTIFACT_EVALUATION',
  'FAILURE_MODE',
  'PROVIDER_EVIDENCE',
  'WORKFLOW_EXPERIENCE',
  'SEMANTIC_RELATION',
  'FEATURE_OBSERVATION',
]);

export const REFERENCE_ROLES = Object.freeze([
  'STYLE_CORE_REFERENCE',
  'IDENTITY_REFERENCE',
  'FACE_REFERENCE',
  'PROPORTION_REFERENCE',
  'POSE_REFERENCE',
  'COSTUME_REFERENCE',
  'COLOR_REFERENCE',
  'LINE_REFERENCE',
  'LIGHTING_REFERENCE',
  'COMPOSITION_REFERENCE',
  'NEGATIVE_REFERENCE',
]);

export const VISUAL_KNOWLEDGE_DIMENSIONS = Object.freeze([
  'IDENTITY',
  'FACE_IDENTITY',
  'CHARACTER_IDENTITY',
  'COSTUME_IDENTITY',
  'GENDER',
  'STRUCTURE',
  'STYLE',
  'SURFACE_RENDERING',
  'PROPORTION_SYNTAX',
  'GARMENT_VOLUME',
  'COMPOSITION_RHYTHM',
  'DETAIL_LANGUAGE',
  'PALETTE_COMPATIBILITY',
  'COLOR',
  'LIGHTING',
  'COMPOSITION',
  'MATERIAL',
  'PRIVACY',
  'LOCALITY',
  'COST',
  'LATENCY',
  'HUMAN_REVIEW',
  'ALPHA',
  'EDGE',
]);

export const EVIDENCE_CLASSES = Object.freeze([
  'UNVERIFIED',
  'FIXTURE',
  'CONTRACT_TESTED',
  'PRIVATE_RESEARCH_AUTHORIZED',
  'HUMAN_OBSERVED',
  'RIGHTS_CLEAR_REAL',
  'PRODUCTION_OBSERVED',
]);

const identityDimensions = Object.freeze([
  'IDENTITY', 'FACE_IDENTITY', 'CHARACTER_IDENTITY', 'COSTUME_IDENTITY', 'GENDER',
]);
const styleObservationDimensions = Object.freeze([
  'SURFACE_RENDERING', 'PROPORTION_SYNTAX', 'GARMENT_VOLUME',
  'COMPOSITION_RHYTHM', 'DETAIL_LANGUAGE', 'PALETTE_COMPATIBILITY',
]);
const rolesWithoutIdentityInfluence = new Set([
  'STYLE_CORE_REFERENCE', 'PROPORTION_REFERENCE', 'POSE_REFERENCE', 'COLOR_REFERENCE',
  'LINE_REFERENCE', 'LIGHTING_REFERENCE', 'COMPOSITION_REFERENCE',
]);
const absolutePath = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|users|var|tmp|opt)\/)/i;
const secret = /(?:BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,})/i;
const universalClaim = /(?:universal|objective(?:ly)?|everyone|all users|always beautiful|普遍|客觀|所有人|永遠最好)/iu;

function object(value) {
  return isPlainJsonObject(value);
}

function exact(value, fields) {
  return object(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every(key => fields.includes(key));
}

function string(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function strings(value, { empty = false, allowed = null } = {}) {
  return isDenseJsonArray(value)
    && (empty || value.length > 0)
    && value.every(item => string(item) && (allowed === null || allowed.includes(item)))
    && new Set(value).size === value.length;
}

function integer(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function finite(value, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function result(reason = null) {
  return reason === null ? { ok: true } : { ok: false, reason };
}

function safe(value) {
  if (typeof value === 'string') return !absolutePath.test(value) && !secret.test(value);
  if (Array.isArray(value)) return value.every(safe);
  if (!object(value)) return value === null || typeof value === 'boolean' || Number.isFinite(value);
  return Object.values(value).every(safe);
}

function provenance(value) {
  return exact(value, ['kind', 'id'])
    && ['HUMAN', 'AI', 'SYSTEM', 'RUNTIME', 'IMPORT'].includes(value.kind)
    && string(value.id);
}

function evidence(value) {
  return EVIDENCE_CLASSES.includes(value);
}

function evidenceProvenanceCompatible(evidenceClass, value) {
  if (!provenance(value)) return false;
  if (value.kind === 'AI'
      && !['UNVERIFIED', 'FIXTURE', 'CONTRACT_TESTED'].includes(evidenceClass)) return false;
  if (evidenceClass === 'HUMAN_OBSERVED' && value.kind !== 'HUMAN') return false;
  if (['PRIVATE_RESEARCH_AUTHORIZED', 'RIGHTS_CLEAR_REAL'].includes(evidenceClass)
      && !['HUMAN', 'IMPORT'].includes(value.kind)) return false;
  if (evidenceClass === 'PRODUCTION_OBSERVED'
      && !['RUNTIME', 'IMPORT'].includes(value.kind)) return false;
  return true;
}

function scope(value, projectId) {
  return exact(value, ['kind', 'projectId', 'taskId'])
    && value.kind === 'PROJECT_LOCAL'
    && value.projectId === projectId
    && (value.taskId === null || string(value.taskId));
}

function operatorRef(value) {
  return exact(value, ['operatorId', 'version'])
    && string(value.operatorId)
    && value.operatorId.startsWith('visual.op.')
    && string(value.version);
}

function evaluator(value) {
  return exact(value, ['kind', 'id', 'version'])
    && ['HUMAN', 'AI', 'DETERMINISTIC', 'HYBRID'].includes(value.kind)
    && string(value.id)
    && string(value.version);
}

function providerRef(value) {
  return exact(value, ['providerId', 'providerVersion'])
    && string(value.providerId)
    && string(value.providerVersion);
}

function recordRef(value) {
  return exact(value, ['kind', 'id'])
    && KNOWLEDGE_RECORD_KINDS.includes(value.kind)
    && string(value.id);
}

function numericSignals(value) {
  return object(value)
    && Object.keys(value).length > 0
    && Object.values(value).every(item => Number.isFinite(item));
}

export function normalizeKnowledgeValue(value, reason = 'visual_knowledge_json_value_invalid') {
  try {
    return normalizeCanonicalJsonValue(value);
  } catch {
    throw new Error(reason);
  }
}

export function cloneKnowledgeValue(value) {
  return JSON.parse(canonicalJson(value));
}

export function sameKnowledgeValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function validateSourceIdentity(value) {
  if (!exact(value, [
    'schema', 'sourceIdentityId', 'projectId', 'sourceKind', 'canonicalLabel',
    'rightsClass', 'evidenceClass', 'evidenceRefs', 'provenance', 'createdAt',
  ])) return result('visual_source_identity_invalid');
  if (value.schema !== 'eve-atelier-visual-source-identity/v1'
      || !string(value.sourceIdentityId)
      || !string(value.projectId)
      || !['HUMAN_PROVIDED', 'GENERATED', 'GAME_RESEARCH', 'SYNTHETIC', 'DERIVED']
        .includes(value.sourceKind)
      || !string(value.canonicalLabel)
      || !['RIGHTS_CLEAR', 'PRIVATE_RESEARCH', 'UNKNOWN'].includes(value.rightsClass)
      || !evidence(value.evidenceClass)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('visual_source_identity_invalid');
  if (value.rightsClass === 'RIGHTS_CLEAR'
      && value.evidenceClass !== 'RIGHTS_CLEAR_REAL') {
    return result('visual_source_rights_evidence_insufficient');
  }
  if (value.rightsClass === 'RIGHTS_CLEAR'
      && !['HUMAN', 'IMPORT'].includes(value.provenance.kind)) {
    return result('visual_source_rights_authority_invalid');
  }
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_source_evidence_provenance_invalid');
  }
  return result();
}

export function validateReferenceAsset(value) {
  if (!exact(value, [
    'schema', 'referenceAssetId', 'projectId', 'assetRef', 'sourceIdentityId',
    'labels', 'status', 'evidenceRefs', 'provenance', 'createdAt',
  ])) return result('visual_reference_asset_invalid');
  if (value.schema !== 'eve-atelier-reference-asset/v1'
      || !string(value.referenceAssetId)
      || !string(value.projectId)
      || !validateAssetRef(value.assetRef).ok
      || !string(value.sourceIdentityId)
      || !strings(value.labels)
      || value.status !== 'ACTIVE'
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('visual_reference_asset_invalid');
  return result();
}

export function validateReferenceRole(value) {
  if (!exact(value, [
    'schema', 'roleBindingId', 'projectId', 'referenceAssetId', 'role',
    'allowedInfluence', 'scope', 'evidenceRefs', 'provenance', 'createdAt',
  ])) return result('visual_reference_role_invalid');
  if (value.schema !== 'eve-atelier-reference-role/v1'
      || !string(value.roleBindingId)
      || !string(value.projectId)
      || !string(value.referenceAssetId)
      || !REFERENCE_ROLES.includes(value.role)
      || !strings(value.allowedInfluence, { allowed: VISUAL_KNOWLEDGE_DIMENSIONS })
      || !scope(value.scope, value.projectId)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('visual_reference_role_invalid');
  if (rolesWithoutIdentityInfluence.has(value.role)
      && value.allowedInfluence.some(item => identityDimensions.includes(item))) {
    return result('visual_reference_role_identity_influence_forbidden');
  }
  return result();
}

export function validateVisualConcept(value) {
  if (!exact(value, [
    'schema', 'conceptId', 'projectId', 'conceptKey', 'version', 'label',
    'description', 'domain', 'initialStatus', 'alternatives', 'evidenceRefs',
    'evidenceClass', 'provenance', 'createdAt',
  ])) return result('visual_concept_invalid');
  if (value.schema !== 'eve-atelier-visual-concept/v1'
      || !string(value.conceptId)
      || !string(value.projectId)
      || !string(value.conceptKey)
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)
      || !string(value.label)
      || !string(value.description)
      || !string(value.domain)
      || value.initialStatus !== 'CANDIDATE'
      || !strings(value.alternatives, { empty: true })
      || !strings(value.evidenceRefs)
      || !evidence(value.evidenceClass)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('visual_concept_invalid');
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_concept_evidence_provenance_invalid');
  }
  return result();
}

export function validateConceptStatusEvent(value) {
  if (!exact(value, [
    'schema', 'statusEventId', 'conceptId', 'projectId', 'fromStatus', 'toStatus',
    'evidenceRefs', 'actor', 'occurredAt',
  ])) return result('visual_concept_status_event_invalid');
  if (value.schema !== 'eve-atelier-visual-concept-status-event/v1'
      || !string(value.statusEventId)
      || !string(value.conceptId)
      || !string(value.projectId)
      || !['CANDIDATE', 'PROVISIONAL', 'ACTIVE', 'DEPRECATED'].includes(value.fromStatus)
      || !['PROVISIONAL', 'ACTIVE', 'DEPRECATED'].includes(value.toStatus)
      || !strings(value.evidenceRefs)
      || !validateArtActor(value.actor, ['HUMAN'])
      || !isCanonicalInstant(value.occurredAt)
      || !safe(value)) return result('visual_concept_status_event_invalid');
  const transitions = new Set([
    'CANDIDATE->PROVISIONAL', 'PROVISIONAL->ACTIVE', 'ACTIVE->DEPRECATED',
  ]);
  if (!transitions.has(`${value.fromStatus}->${value.toStatus}`)) {
    return result('visual_concept_status_transition_invalid');
  }
  return result();
}

export function validateStyleObservation(value) {
  if (!exact(value, [
    'schema', 'observationId', 'projectId', 'subjectReferenceAssetId',
    'comparisonReferenceAssetId', 'evaluator', 'conditioning', 'dimensions',
    'limitations', 'evidenceClass', 'evidenceRefs', 'provenance', 'createdAt',
  ])) return result('visual_style_observation_invalid');
  if (value.schema !== 'eve-atelier-style-observation/v1'
      || !string(value.observationId)
      || !string(value.projectId)
      || !string(value.subjectReferenceAssetId)
      || (value.comparisonReferenceAssetId !== null
        && !string(value.comparisonReferenceAssetId))
      || !evaluator(value.evaluator)
      || !exact(value.conditioning, ['kind', 'identityRef', 'version'])
      || !['NONE', 'MODEL', 'PROVIDER'].includes(value.conditioning.kind)
      || (value.conditioning.kind === 'NONE'
        ? value.conditioning.identityRef !== null || value.conditioning.version !== null
        : !string(value.conditioning.identityRef) || !string(value.conditioning.version))
      || !object(value.dimensions)
      || Object.keys(value.dimensions).length === 0
      || Object.keys(value.dimensions).some(key => !styleObservationDimensions.includes(key))
      || !strings(value.limitations, { empty: true })
      || !evidence(value.evidenceClass)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('visual_style_observation_invalid');
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_style_observation_evidence_provenance_invalid');
  }
  for (const dimension of Object.values(value.dimensions)) {
    if (!exact(dimension, ['status', 'confidence', 'evidenceRefs', 'notes'])
        || !['MATCH', 'MISMATCH', 'UNKNOWN'].includes(dimension.status)
        || !finite(dimension.confidence, { min: 0, max: 1 })
        || !strings(dimension.evidenceRefs)
        || !strings(dimension.notes, { empty: true })) {
      return result('visual_style_observation_dimension_invalid');
    }
  }
  return result();
}

export function validatePreferenceEvent(value) {
  if (!exact(value, [
    'schema', 'preferenceId', 'projectId', 'observer', 'subjectReferenceAssetId',
    'comparisonReferenceAssetId', 'stance', 'dimensions', 'reason', 'scope',
    'evidenceClass', 'evidenceRefs', 'observedAt',
  ])) return result('visual_preference_event_invalid');
  if (value.schema !== 'eve-atelier-preference-event/v1'
      || !string(value.preferenceId)
      || !string(value.projectId)
      || !validateArtActor(value.observer, ['HUMAN'])
      || !string(value.subjectReferenceAssetId)
      || (value.comparisonReferenceAssetId !== null
        && !string(value.comparisonReferenceAssetId))
      || !['LIKE', 'DISLIKE', 'PREFER_SUBJECT', 'PREFER_COMPARISON', 'TIE'].includes(value.stance)
      || !strings(value.dimensions, { allowed: VISUAL_KNOWLEDGE_DIMENSIONS })
      || !string(value.reason)
      || universalClaim.test(value.reason)
      || !scope(value.scope, value.projectId)
      || value.evidenceClass !== 'HUMAN_OBSERVED'
      || !strings(value.evidenceRefs)
      || !isCanonicalInstant(value.observedAt)
      || !safe(value)) return result('visual_preference_event_invalid');
  if ((value.comparisonReferenceAssetId === null
      && !['LIKE', 'DISLIKE'].includes(value.stance))
      || (value.comparisonReferenceAssetId !== null
        && !['PREFER_SUBJECT', 'PREFER_COMPARISON', 'TIE'].includes(value.stance))) {
    return result('visual_preference_comparison_shape_invalid');
  }
  return result();
}

export function validateArtifactEvaluation(value) {
  if (!exact(value, [
    'schema', 'knowledgeEvaluationId', 'projectId', 'assetRef', 'documentId',
    'versionId', 'sourceEvaluationId', 'verdict', 'evaluator', 'dimensionResults',
    'evidenceClass', 'evidenceRefs', 'provenance', 'observedAt',
  ])) return result('visual_artifact_evaluation_invalid');
  if (value.schema !== 'eve-atelier-artifact-evaluation/v1'
      || !string(value.knowledgeEvaluationId)
      || !string(value.projectId)
      || !validateAssetRef(value.assetRef).ok
      || !string(value.documentId)
      || !string(value.versionId)
      || !string(value.sourceEvaluationId)
      || !['ACCEPT', 'ACCEPT_WITH_WARNINGS', 'REPAIR', 'REJECT', 'UNVERIFIED']
        .includes(value.verdict)
      || !evaluator(value.evaluator)
      || !object(value.dimensionResults)
      || Object.keys(value.dimensionResults).length === 0
      || !evidence(value.evidenceClass)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.observedAt)
      || !safe(value)) return result('visual_artifact_evaluation_invalid');
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_artifact_evaluation_evidence_provenance_invalid');
  }
  return result();
}

export function validateFailureMode(value) {
  if (!exact(value, [
    'schema', 'failureModeId', 'projectId', 'code', 'label', 'description',
    'dimensions', 'referenceAssetIds', 'status', 'evidenceClass', 'evidenceRefs',
    'provenance', 'observedAt',
  ])) return result('visual_failure_mode_invalid');
  if (value.schema !== 'eve-atelier-failure-mode/v1'
      || !string(value.failureModeId)
      || !string(value.projectId)
      || !string(value.code)
      || !string(value.label)
      || !string(value.description)
      || !strings(value.dimensions, { allowed: VISUAL_KNOWLEDGE_DIMENSIONS })
      || !strings(value.referenceAssetIds, { empty: true })
      || !['OBSERVED', 'PROVISIONAL'].includes(value.status)
      || !evidence(value.evidenceClass)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.observedAt)
      || !safe(value)) return result('visual_failure_mode_invalid');
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_failure_mode_evidence_provenance_invalid');
  }
  return result();
}

export function validateProviderCapabilityEvidence(value) {
  if (!exact(value, [
    'schema', 'providerEvidenceId', 'projectId', 'sourceExecutionId', 'providerRef', 'operatorRef',
    'outcome', 'qualitySignals', 'contextTags', 'evidenceClass', 'evidenceRefs',
    'provenance', 'observedAt',
  ])) return result('visual_provider_evidence_invalid');
  if (value.schema !== 'eve-atelier-provider-capability-evidence/v1'
      || !string(value.providerEvidenceId)
      || !string(value.projectId)
      || !string(value.sourceExecutionId)
      || !providerRef(value.providerRef)
      || !operatorRef(value.operatorRef)
      || !['SUCCESS', 'FAILURE', 'UNCERTAIN'].includes(value.outcome)
      || !numericSignals(value.qualitySignals)
      || !strings(value.contextTags, { empty: true })
      || !evidence(value.evidenceClass)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.observedAt)
      || !safe(value)) return result('visual_provider_evidence_invalid');
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_provider_evidence_provenance_invalid');
  }
  return result();
}

export function validateWorkflowExperience(value) {
  if (!exact(value, [
    'schema', 'workflowExperienceId', 'projectId', 'sessionId', 'sessionDigest',
    'workflowId', 'taskType', 'outcome', 'operatorRefs', 'providerEvidenceRefs',
    'artifactEvaluationRefs', 'preferenceRefs', 'failureModeRefs', 'budgetUse',
    'evidenceClass', 'evidenceRefs', 'provenance', 'occurredAt',
  ])) return result('visual_workflow_experience_invalid');
  if (value.schema !== 'eve-atelier-workflow-experience/v1'
      || !string(value.workflowExperienceId)
      || !string(value.projectId)
      || !string(value.sessionId)
      || !/^[a-f0-9]{64}$/.test(value.sessionDigest)
      || !string(value.workflowId)
      || !string(value.taskType)
      || !['ACCEPTED', 'REJECTED', 'FAILED', 'UNCERTAIN'].includes(value.outcome)
      || !isDenseJsonArray(value.operatorRefs)
      || value.operatorRefs.some(item => !operatorRef(item))
      || !strings(value.providerEvidenceRefs, { empty: true })
      || !strings(value.artifactEvaluationRefs, { empty: true })
      || !strings(value.preferenceRefs, { empty: true })
      || !strings(value.failureModeRefs, { empty: true })
      || !exact(value.budgetUse, [
        'iterations', 'providerCalls', 'candidates', 'repairLoops',
        'costUnits', 'latencyMs',
      ])
      || Object.values(value.budgetUse).some(item => !finite(item))
      || !evidence(value.evidenceClass)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.occurredAt)
      || !safe(value)) return result('visual_workflow_experience_invalid');
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_workflow_experience_evidence_provenance_invalid');
  }
  return result();
}

export function validateSemanticRelation(value) {
  if (!exact(value, [
    'schema', 'relationId', 'projectId', 'layer', 'subject', 'predicate',
    'object', 'confidence', 'observerRef', 'evidenceClass', 'evidenceRefs',
    'provenance', 'createdAt',
  ])) return result('visual_semantic_relation_invalid');
  if (value.schema !== 'eve-atelier-semantic-relation/v1'
      || !string(value.relationId)
      || !string(value.projectId)
      || !['ARTIFACT', 'PERCEPTUAL', 'SHARED_DOMAIN', 'OBSERVER_PROJECTION'].includes(value.layer)
      || !recordRef(value.subject)
      || !string(value.predicate)
      || !recordRef(value.object)
      || !finite(value.confidence, { min: 0, max: 1 })
      || (value.observerRef !== null && !validateArtActor(value.observerRef, ['HUMAN', 'AI']))
      || !evidence(value.evidenceClass)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('visual_semantic_relation_invalid');
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_semantic_relation_evidence_provenance_invalid');
  }
  if ((value.layer === 'OBSERVER_PROJECTION') !== (value.observerRef !== null)) {
    return result('visual_semantic_relation_observer_scope_invalid');
  }
  return result();
}

export function validateFeatureObservation(value) {
  if (!exact(value, [
    'schema', 'featureObservationId', 'projectId', 'referenceAssetId', 'extractor',
    'vector', 'normalization', 'evidenceClass', 'evidenceRefs', 'provenance',
    'createdAt',
  ])) return result('visual_feature_observation_invalid');
  if (value.schema !== 'eve-atelier-feature-observation/v1'
      || !string(value.featureObservationId)
      || !string(value.projectId)
      || !string(value.referenceAssetId)
      || !exact(value.extractor, ['id', 'version', 'spaceId', 'dimensions'])
      || !string(value.extractor.id)
      || !string(value.extractor.version)
      || !string(value.extractor.spaceId)
      || !integer(value.extractor.dimensions, { min: 2, max: 2048 })
      || !isDenseJsonArray(value.vector)
      || value.vector.length !== value.extractor.dimensions
      || value.vector.some(item => !Number.isFinite(item))
      || value.normalization !== 'L2'
      || !evidence(value.evidenceClass)
      || !strings(value.evidenceRefs)
      || !provenance(value.provenance)
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('visual_feature_observation_invalid');
  if (!evidenceProvenanceCompatible(value.evidenceClass, value.provenance)) {
    return result('visual_feature_evidence_provenance_invalid');
  }
  const norm = Math.sqrt(value.vector.reduce((sum, item) => sum + (item * item), 0));
  if (Math.abs(norm - 1) > 1e-6) return result('visual_feature_vector_not_l2_normalized');
  return result();
}

const selectedFields = Object.freeze([
  'referenceAssetIds', 'conceptIds', 'styleObservationIds', 'preferenceIds',
  'artifactEvaluationIds', 'failureModeIds', 'providerEvidenceIds',
  'workflowExperienceIds', 'semanticRelationIds',
]);

export function validateRetrievalContext(value) {
  if (!exact(value, [
    'schema', 'retrievalContextId', 'projectId', 'query', 'knowledgeRevision',
    'atlasSnapshotId', 'atlasSourceDigest', 'selected', 'selectionEvidence', 'createdAt',
  ])) return result('visual_retrieval_context_invalid');
  if (value.schema !== 'eve-atelier-visual-retrieval-context/v1'
      || !string(value.retrievalContextId)
      || !string(value.projectId)
      || !exact(value.query, [
        'taskType', 'dimensions', 'roles', 'allowedRightsClasses', 'text', 'limit',
      ])
      || !string(value.query.taskType)
      || !strings(value.query.dimensions, { empty: true, allowed: VISUAL_KNOWLEDGE_DIMENSIONS })
      || !strings(value.query.roles, { empty: true, allowed: REFERENCE_ROLES })
      || !strings(value.query.allowedRightsClasses, {
        allowed: ['RIGHTS_CLEAR', 'PRIVATE_RESEARCH', 'UNKNOWN'],
      })
      || !string(value.query.text)
      || !integer(value.query.limit, { min: 1, max: 100 })
      || !integer(value.knowledgeRevision, { min: 1 })
      || !string(value.atlasSnapshotId)
      || !/^[a-f0-9]{64}$/.test(value.atlasSourceDigest)
      || !exact(value.selected, selectedFields)
      || Object.values(value.selected).some(items => !strings(items, { empty: true }))
      || !isDenseJsonArray(value.selectionEvidence)
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('visual_retrieval_context_invalid');
  const seen = new Set();
  for (const item of value.selectionEvidence) {
    if (!exact(item, ['recordKind', 'recordId', 'score', 'reasons'])
        || !KNOWLEDGE_RECORD_KINDS.includes(item.recordKind)
        || !string(item.recordId)
        || seen.has(`${item.recordKind}:${item.recordId}`)
        || !finite(item.score, { min: 0, max: 1 })
        || !strings(item.reasons)) return result('visual_retrieval_selection_invalid');
    seen.add(`${item.recordKind}:${item.recordId}`);
  }
  const selectedIds = new Set(Object.values(value.selected).flat());
  if (selectedIds.size !== value.selectionEvidence.length
      || value.selectionEvidence.some(item => !selectedIds.has(item.recordId))) {
    return result('visual_retrieval_selection_evidence_mismatch');
  }
  return result();
}

export function validateAtlasSnapshot(value) {
  if (!exact(value, [
    'schema', 'atlasSnapshotId', 'projectId', 'knowledgeRevision', 'sourceDigest',
    'clusterThreshold', 'referenceCards', 'clusters', 'favorites',
    'negativeReferenceAssetIds', 'createdAt',
  ])) return result('style_atlas_snapshot_invalid');
  if (value.schema !== 'eve-atelier-style-atlas-snapshot/v1'
      || !string(value.atlasSnapshotId)
      || !string(value.projectId)
      || !integer(value.knowledgeRevision, { min: 1 })
      || !/^[a-f0-9]{64}$/.test(value.sourceDigest)
      || !finite(value.clusterThreshold, { min: -1, max: 1 })
      || !isDenseJsonArray(value.referenceCards)
      || !isDenseJsonArray(value.clusters)
      || !isDenseJsonArray(value.favorites)
      || !strings(value.negativeReferenceAssetIds, { empty: true })
      || !isCanonicalInstant(value.createdAt)
      || !safe(value)) return result('style_atlas_snapshot_invalid');
  const cards = new Set();
  for (const card of value.referenceCards) {
    if (!exact(card, [
      'referenceAssetId', 'assetRef', 'rightsClass', 'labels', 'roles', 'conceptIds',
      'acceptedEvaluationIds', 'rejectedEvaluationIds', 'preferenceScore',
    ])
        || !string(card.referenceAssetId)
        || cards.has(card.referenceAssetId)
        || !validateAssetRef(card.assetRef).ok
        || !['RIGHTS_CLEAR', 'PRIVATE_RESEARCH', 'UNKNOWN'].includes(card.rightsClass)
        || !strings(card.labels)
        || !strings(card.roles, { empty: true, allowed: REFERENCE_ROLES })
        || !strings(card.conceptIds, { empty: true })
        || !strings(card.acceptedEvaluationIds, { empty: true })
        || !strings(card.rejectedEvaluationIds, { empty: true })
        || !Number.isFinite(card.preferenceScore)) return result('style_atlas_reference_card_invalid');
    cards.add(card.referenceAssetId);
  }
  for (const cluster of value.clusters) {
    if (!exact(cluster, ['clusterId', 'extractorRef', 'memberReferenceAssetIds', 'minimumSimilarity'])
        || !string(cluster.clusterId)
        || !exact(cluster.extractorRef, ['id', 'version', 'spaceId', 'dimensions'])
        || !string(cluster.extractorRef.id)
        || !string(cluster.extractorRef.version)
        || !string(cluster.extractorRef.spaceId)
        || !integer(cluster.extractorRef.dimensions, { min: 2, max: 2048 })
        || !strings(cluster.memberReferenceAssetIds)
        || cluster.memberReferenceAssetIds.some(id => !cards.has(id))
        || !finite(cluster.minimumSimilarity, { min: -1, max: 1 })) {
      return result('style_atlas_cluster_invalid');
    }
  }
  for (const favorite of value.favorites) {
    if (!exact(favorite, ['referenceAssetId', 'score', 'preferenceIds'])
        || !cards.has(favorite.referenceAssetId)
        || !Number.isSafeInteger(favorite.score)
        || !strings(favorite.preferenceIds)) return result('style_atlas_favorite_invalid');
  }
  if (value.negativeReferenceAssetIds.some(id => !cards.has(id))) {
    return result('style_atlas_negative_reference_missing');
  }
  return result();
}

export const visualKnowledgeValidators = Object.freeze({
  SOURCE_IDENTITY: validateSourceIdentity,
  REFERENCE_ASSET: validateReferenceAsset,
  REFERENCE_ROLE: validateReferenceRole,
  VISUAL_CONCEPT: validateVisualConcept,
  STYLE_OBSERVATION: validateStyleObservation,
  PREFERENCE_EVENT: validatePreferenceEvent,
  ARTIFACT_EVALUATION: validateArtifactEvaluation,
  FAILURE_MODE: validateFailureMode,
  PROVIDER_EVIDENCE: validateProviderCapabilityEvidence,
  WORKFLOW_EXPERIENCE: validateWorkflowExperience,
  SEMANTIC_RELATION: validateSemanticRelation,
  FEATURE_OBSERVATION: validateFeatureObservation,
});
