import {
  isDenseJsonArray,
  isPlainJsonObject,
  normalizeCanonicalJsonValue,
} from '../operator-runtime/json-values.js';
import { canonicalJson } from '../operator-runtime/canonical.js';
import { isCanonicalInstant } from '../operator-runtime/time.js';

export const ART_TARGET_KINDS = Object.freeze([
  'DOCUMENT',
  'DOCUMENT_VERSION',
  'LAYER',
  'MASK',
  'SELECTION',
  'REGION',
  'STRUCTURE',
  'FIELD',
]);

const actorKinds = Object.freeze(['HUMAN', 'AI', 'SYSTEM']);
const promotionPolicies = Object.freeze(['automatic_deterministic', 'human_required']);
const evaluationVerdicts = Object.freeze([
  'ACCEPT',
  'ACCEPT_WITH_WARNINGS',
  'REPAIR',
  'REJECT',
  'UNVERIFIED',
]);
const reviewDispositions = Object.freeze(['APPROVE', 'ACCEPT_WITH_WARNINGS', 'REJECT']);
const versionKinds = Object.freeze(['SOURCE', 'CANDIDATE']);

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

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function strings(value, { empty = false } = {}) {
  return isDenseJsonArray(value)
    && (empty || value.length > 0)
    && value.every(string)
    && new Set(value).size === value.length;
}

function result(reason) {
  return reason ? { ok: false, reason } : { ok: true };
}

function containsAuthorityKey(value) {
  if (Array.isArray(value)) return value.some(containsAuthorityKey);
  if (!object(value)) return false;
  return Object.entries(value).some(([key, item]) => (
    /(accept|approv|promot|authority|currentVersion)/i.test(key)
    || containsAuthorityKey(item)
  ));
}

export function normalizeArtValue(value, reason = 'art_domain_json_value_invalid') {
  try {
    return normalizeCanonicalJsonValue(value);
  } catch {
    throw new Error(reason);
  }
}

export function cloneArtValue(value) {
  return JSON.parse(canonicalJson(value));
}

export function sameArtValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function validateArtActor(value, allowedKinds = actorKinds) {
  return exact(value, ['kind', 'id'])
    && allowedKinds.includes(value.kind)
    && string(value.id);
}

export function validateAssetRef(value) {
  if (!exact(value, ['assetId', 'sha256', 'mediaType', 'byteSize'])) {
    return result('art_asset_ref_invalid');
  }
  if (!string(value.assetId)
      || value.assetId !== `asset:sha256:${value.sha256.toLowerCase()}`
      || !sha256(value.sha256)
      || !string(value.mediaType)
      || !Number.isSafeInteger(value.byteSize)
      || value.byteSize < 0) {
    return result('art_asset_ref_invalid');
  }
  return result();
}

export function validateArtProject(value) {
  if (!exact(value, [
    'schema', 'projectId', 'canonicalName', 'workspaceId', 'assetNamespace',
    'semanticScope', 'createdAt', 'status',
  ])) return result('art_project_invalid');
  if (value.schema !== 'eve-atelier-art-project/v1'
      || !string(value.projectId)
      || !string(value.canonicalName)
      || !string(value.workspaceId)
      || !string(value.assetNamespace)
      || !string(value.semanticScope)
      || !isCanonicalInstant(value.createdAt)
      || value.status !== 'ACTIVE') return result('art_project_invalid');
  return result();
}

export function validateArtDocument(value) {
  if (!exact(value, [
    'schema', 'documentId', 'projectId', 'documentType', 'colorSpace',
    'canvasExtent', 'promotionPolicy', 'createdAt', 'status',
  ])) return result('art_document_invalid');
  if (value.schema !== 'eve-atelier-art-document/v1'
      || !string(value.documentId)
      || !string(value.projectId)
      || !string(value.documentType)
      || !string(value.colorSpace)
      || !exact(value.canvasExtent, ['width', 'height'])
      || !Number.isSafeInteger(value.canvasExtent.width)
      || value.canvasExtent.width < 1
      || !Number.isSafeInteger(value.canvasExtent.height)
      || value.canvasExtent.height < 1
      || !promotionPolicies.includes(value.promotionPolicy)
      || !isCanonicalInstant(value.createdAt)
      || value.status !== 'ACTIVE') return result('art_document_invalid');
  return result();
}

export function validateArtDocumentVersion(value) {
  if (!exact(value, [
    'schema', 'versionId', 'documentId', 'parentVersionIds', 'primaryAsset',
    'primaryAssetStatus', 'canvasExtent', 'colorSpace', 'createdByExecutionId',
    'createdAt', 'kind',
  ])) return result('art_document_version_invalid');
  const asset = validateAssetRef(value.primaryAsset);
  if (value.schema !== 'eve-atelier-art-document-version/v1'
      || !string(value.versionId)
      || !string(value.documentId)
      || !strings(value.parentVersionIds, { empty: true })
      || !asset.ok
      || !['CURRENT_RENDER', 'STALE_REQUIRES_COMPOSITE'].includes(value.primaryAssetStatus)
      || !exact(value.canvasExtent, ['width', 'height'])
      || !Number.isSafeInteger(value.canvasExtent.width)
      || value.canvasExtent.width < 1
      || !Number.isSafeInteger(value.canvasExtent.height)
      || value.canvasExtent.height < 1
      || !string(value.colorSpace)
      || (value.createdByExecutionId !== null && !string(value.createdByExecutionId))
      || !isCanonicalInstant(value.createdAt)
      || !versionKinds.includes(value.kind)) return result('art_document_version_invalid');
  if (value.kind === 'SOURCE'
      && (value.parentVersionIds.length !== 0
        || value.createdByExecutionId !== null
        || value.primaryAssetStatus !== 'CURRENT_RENDER')) {
    return result('art_source_version_lineage_invalid');
  }
  if (value.kind === 'CANDIDATE'
      && (value.parentVersionIds.length === 0 || value.createdByExecutionId === null)) {
    return result('art_candidate_version_lineage_required');
  }
  return result();
}

export function validateArtAssetBinding(value) {
  if (!exact(value, [
    'schema', 'bindingId', 'documentId', 'versionId', 'assetRef', 'assetRole',
    'target', 'createdAt',
  ])) return result('art_asset_binding_invalid');
  if (value.schema !== 'eve-atelier-art-asset-binding/v1'
      || !string(value.bindingId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !validateAssetRef(value.assetRef).ok
      || !string(value.assetRole)
      || !exact(value.target, ['kind', 'id'])
      || !['DOCUMENT_VERSION', 'LAYER', 'MASK', 'SELECTION', 'FIELD'].includes(value.target.kind)
      || !string(value.target.id)
      || !isCanonicalInstant(value.createdAt)) return result('art_asset_binding_invalid');
  return result();
}

export function validateArtLayer(value) {
  if (!exact(value, [
    'schema', 'layerId', 'documentId', 'versionId', 'name', 'layerType', 'order',
    'visibility', 'opacity', 'blendMode', 'parentLayerId', 'assetRef', 'maskIds', 'createdAt',
  ])) return result('art_layer_invalid');
  if (value.schema !== 'eve-atelier-art-layer/v1'
      || !string(value.layerId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !string(value.name)
      || !['RASTER', 'VECTOR', 'GROUP', 'ADJUSTMENT', 'GENERATED', 'LIGHTING_PASS', 'EXTERNAL'].includes(value.layerType)
      || !Number.isSafeInteger(value.order)
      || value.order < 0
      || typeof value.visibility !== 'boolean'
      || !Number.isFinite(value.opacity)
      || value.opacity < 0
      || value.opacity > 1
      || !string(value.blendMode)
      || (value.parentLayerId !== null && !string(value.parentLayerId))
      || (value.assetRef !== null && !validateAssetRef(value.assetRef).ok)
      || !strings(value.maskIds, { empty: true })
      || !isCanonicalInstant(value.createdAt)) return result('art_layer_invalid');
  if (value.layerType === 'GROUP' && value.assetRef !== null) {
    return result('art_layer_group_asset_forbidden');
  }
  return result();
}

export function validateArtMask(value) {
  if (!exact(value, [
    'schema', 'maskId', 'documentId', 'versionId', 'maskType', 'assetRef',
    'semanticTarget', 'createdAt',
  ])) return result('art_mask_invalid');
  if (value.schema !== 'eve-atelier-art-mask/v1'
      || !string(value.maskId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !['ALPHA', 'SELECTION', 'SEMANTIC_REGION', 'DEPTH_RANGE', 'STRUCTURE_PART', 'PROVIDER_CONTROL'].includes(value.maskType)
      || !validateAssetRef(value.assetRef).ok
      || !string(value.semanticTarget)
      || !isCanonicalInstant(value.createdAt)) return result('art_mask_invalid');
  return result();
}

export function validateArtSelection(value) {
  if (!exact(value, [
    'schema', 'selectionId', 'documentId', 'versionId', 'representation',
    'semanticLabel', 'createdAt',
  ])) return result('art_selection_invalid');
  if (value.schema !== 'eve-atelier-art-selection/v1'
      || !string(value.selectionId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !exact(value.representation, ['kind', 'assetRef', 'geometryRef', 'revision'])
      || !['MASK', 'GEOMETRY'].includes(value.representation.kind)
      || (value.representation.assetRef !== null
        && !validateAssetRef(value.representation.assetRef).ok)
      || (value.representation.geometryRef !== null
        && !string(value.representation.geometryRef))
      || !Number.isSafeInteger(value.representation.revision)
      || value.representation.revision < 0
      || !string(value.semanticLabel)
      || !isCanonicalInstant(value.createdAt)) return result('art_selection_invalid');
  if (value.representation.kind === 'MASK'
      && (value.representation.assetRef === null
        || value.representation.geometryRef !== null)) {
    return result('art_selection_mask_representation_invalid');
  }
  if (value.representation.kind === 'GEOMETRY'
      && (value.representation.geometryRef === null
        || value.representation.assetRef !== null)) {
    return result('art_selection_geometry_representation_invalid');
  }
  return result();
}

export function validateArtRegion(value) {
  if (!exact(value, [
    'schema', 'regionId', 'documentId', 'versionId', 'regionType',
    'semanticLabel', 'representation', 'confidence', 'createdAt',
  ])) return result('art_region_invalid');
  if (value.schema !== 'eve-atelier-art-region/v1'
      || !string(value.regionId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !string(value.regionType)
      || !string(value.semanticLabel)
      || !exact(value.representation, ['kind', 'refId', 'revision'])
      || !['MASK', 'GEOMETRY', 'UNRESOLVED'].includes(value.representation.kind)
      || (value.representation.refId !== null && !string(value.representation.refId))
      || !Number.isSafeInteger(value.representation.revision)
      || value.representation.revision < 0
      || !Number.isFinite(value.confidence)
      || value.confidence < 0
      || value.confidence > 1
      || !isCanonicalInstant(value.createdAt)) return result('art_region_invalid');
  if (value.representation.kind === 'UNRESOLVED' && value.representation.refId !== null) {
    return result('art_region_unresolved_ref_forbidden');
  }
  if (value.representation.kind !== 'UNRESOLVED' && value.representation.refId === null) {
    return result('art_region_representation_ref_required');
  }
  return result();
}

export function validateArtStructureBinding(value) {
  if (!exact(value, [
    'schema', 'structureId', 'documentId', 'versionId', 'structureType',
    'providerResourceRef', 'revision', 'createdAt',
  ])) return result('art_structure_binding_invalid');
  if (value.schema !== 'eve-atelier-art-structure-binding/v1'
      || !string(value.structureId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !string(value.structureType)
      || !string(value.providerResourceRef)
      || !Number.isSafeInteger(value.revision)
      || value.revision < 0
      || !isCanonicalInstant(value.createdAt)) return result('art_structure_binding_invalid');
  return result();
}

export function validateArtFieldBinding(value) {
  if (!exact(value, [
    'schema', 'fieldBindingId', 'documentId', 'versionId', 'fieldType',
    'providerRef', 'derivedFromAsset', 'revision', 'confidence', 'createdAt',
  ])) return result('art_field_binding_invalid');
  if (value.schema !== 'eve-atelier-art-field-binding/v1'
      || !string(value.fieldBindingId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !string(value.fieldType)
      || !exact(value.providerRef, ['providerId', 'providerVersion', 'resourceId'])
      || !string(value.providerRef.providerId)
      || !string(value.providerRef.providerVersion)
      || !string(value.providerRef.resourceId)
      || !validateAssetRef(value.derivedFromAsset).ok
      || !Number.isSafeInteger(value.revision)
      || value.revision < 0
      || !Number.isFinite(value.confidence)
      || value.confidence < 0
      || value.confidence > 1
      || !isCanonicalInstant(value.createdAt)) return result('art_field_binding_invalid');
  return result();
}

export function validateArtEvaluation(value) {
  if (!exact(value, [
    'schema', 'evaluationId', 'documentId', 'versionId', 'verdict',
    'evaluator', 'measurements', 'evidenceRefs', 'warnings', 'evaluatedAt',
  ])) return result('art_evaluation_invalid');
  if (value.schema !== 'eve-atelier-art-evaluation/v1'
      || !string(value.evaluationId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !evaluationVerdicts.includes(value.verdict)
      || !exact(value.evaluator, ['kind', 'id', 'version'])
      || !['HUMAN', 'AI', 'DETERMINISTIC', 'HYBRID'].includes(value.evaluator.kind)
      || !string(value.evaluator.id)
      || !string(value.evaluator.version)
      || !object(value.measurements)
      || Object.keys(value.measurements).length === 0
      || containsAuthorityKey(value.measurements)
      || !strings(value.evidenceRefs)
      || !strings(value.warnings, { empty: true })
      || !isCanonicalInstant(value.evaluatedAt)) return result('art_evaluation_invalid');
  return result();
}

export function validateArtHumanReview(value) {
  if (!exact(value, [
    'schema', 'reviewId', 'documentId', 'versionId', 'reviewer', 'disposition',
    'reason', 'evidenceRefs', 'reviewedAt',
  ])) return result('art_human_review_invalid');
  if (value.schema !== 'eve-atelier-art-human-review/v1'
      || !string(value.reviewId)
      || !string(value.documentId)
      || !string(value.versionId)
      || !validateArtActor(value.reviewer, ['HUMAN'])
      || !reviewDispositions.includes(value.disposition)
      || !string(value.reason)
      || !strings(value.evidenceRefs)
      || !isCanonicalInstant(value.reviewedAt)) return result('art_human_review_invalid');
  return result();
}

export function validateArtCurrentEvent(value) {
  if (!exact(value, [
    'schema', 'eventId', 'documentId', 'fromVersionId', 'toVersionId', 'reason',
    'evaluationId', 'reviewId', 'evidenceRefs', 'actor', 'occurredAt',
  ])) return result('art_current_event_invalid');
  if (value.schema !== 'eve-atelier-art-current-event/v1'
      || !string(value.eventId)
      || !string(value.documentId)
      || (value.fromVersionId !== null && !string(value.fromVersionId))
      || !string(value.toVersionId)
      || !['INITIAL', 'PROMOTION', 'RESTORE'].includes(value.reason)
      || (value.evaluationId !== null && !string(value.evaluationId))
      || (value.reviewId !== null && !string(value.reviewId))
      || !strings(value.evidenceRefs)
      || !validateArtActor(value.actor)
      || !isCanonicalInstant(value.occurredAt)) return result('art_current_event_invalid');
  if (value.reason === 'INITIAL'
      && (value.fromVersionId !== null || value.evaluationId !== null || value.reviewId !== null)) {
    return result('art_initial_event_invalid');
  }
  return result();
}

export function validateOperatorExecutionReceipt(value) {
  if (!exact(value, [
    'schema', 'executionId', 'operationId', 'packRef', 'operatorRef', 'target',
    'expectedRevision', 'revisionValidation', 'providerRef', 'inputArtifacts',
    'outputArtifacts', 'startedAt', 'finishedAt', 'status', 'reproducibility', 'metadata',
  ])) return result('art_operator_execution_receipt_invalid');
  if (value.schema !== 'eve-atelier-operator-execution-receipt/v1'
      || !string(value.executionId)
      || !string(value.operationId)
      || !exact(value.packRef, ['packId', 'version', 'digest'])
      || !string(value.packRef.packId)
      || !string(value.packRef.version)
      || !sha256(value.packRef.digest)
      || !exact(value.operatorRef, ['operatorId', 'version'])
      || !string(value.operatorRef.operatorId)
      || !string(value.operatorRef.version)
      || !exact(value.target, ['kind', 'id'])
      || !string(value.target.kind)
      || !string(value.target.id)
      || !Number.isSafeInteger(value.expectedRevision)
      || value.expectedRevision < 0
      || !exact(value.revisionValidation, ['status', 'evidenceRef'])
      || value.revisionValidation.status !== 'VERIFIED'
      || !string(value.revisionValidation.evidenceRef)
      || !exact(value.providerRef, ['providerId', 'providerVersion'])
      || !string(value.providerRef.providerId)
      || !string(value.providerRef.providerVersion)
      || !isDenseJsonArray(value.inputArtifacts)
      || value.inputArtifacts.length === 0
      || !isDenseJsonArray(value.outputArtifacts)
      || value.outputArtifacts.length === 0
      || !isCanonicalInstant(value.startedAt)
      || !isCanonicalInstant(value.finishedAt)
      || Date.parse(value.finishedAt) < Date.parse(value.startedAt)
      || value.status !== 'completed'
      || !['exact', 'seeded_stochastic', 'non_reproducible'].includes(value.reproducibility)
      || !object(value.metadata)
      || containsAuthorityKey(value.metadata)) {
    return result('art_operator_execution_receipt_invalid');
  }
  for (const artifact of [...value.inputArtifacts, ...value.outputArtifacts]) {
    if (!exact(artifact, ['artifactId', 'sha256'])
        || !string(artifact.artifactId)
        || !sha256(artifact.sha256)) {
      return result('art_operator_execution_receipt_invalid');
    }
  }
  return result();
}

export function validateArtOperatorTarget(value) {
  if (!exact(value, [
    'schema', 'targetId', 'targetKind', 'projectId', 'documentId', 'versionId',
    'componentId', 'expectedCurrentVersionId', 'expectedDocumentRevision',
    'expectedCanvasRevision',
  ])) return result('art_operator_target_invalid');
  if (value.schema !== 'eve-atelier-art-operator-target/v1'
      || !string(value.targetId)
      || !ART_TARGET_KINDS.includes(value.targetKind)
      || !string(value.projectId)
      || !string(value.documentId)
      || !string(value.versionId)
      || (value.componentId !== null && !string(value.componentId))
      || (value.expectedCurrentVersionId !== null && !string(value.expectedCurrentVersionId))
      || !Number.isSafeInteger(value.expectedDocumentRevision)
      || value.expectedDocumentRevision < 1
      || (value.expectedCanvasRevision !== null
        && (!Number.isSafeInteger(value.expectedCanvasRevision)
          || value.expectedCanvasRevision < 0))) return result('art_operator_target_invalid');
  if (['DOCUMENT', 'DOCUMENT_VERSION'].includes(value.targetKind)
      && value.componentId !== null) return result('art_operator_target_component_forbidden');
  if (!['DOCUMENT', 'DOCUMENT_VERSION'].includes(value.targetKind)
      && value.componentId === null) return result('art_operator_target_component_required');
  return result();
}
