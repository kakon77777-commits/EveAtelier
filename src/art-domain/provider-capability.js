import {
  isDenseJsonArray,
  isPlainJsonObject,
  normalizeCanonicalJsonValue,
} from '../operator-runtime/json-values.js';
import { isCanonicalInstant } from '../operator-runtime/time.js';

const evidenceRank = Object.freeze({
  PRODUCTION_OBSERVED: 5,
  RIGHTS_CLEAR_REAL: 4,
  PRIVATE_RESEARCH_AUTHORIZED: 3,
  CONTRACT_TESTED: 2,
  FIXTURE: 1,
});

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

function strings(value, { empty = false } = {}) {
  return isDenseJsonArray(value)
    && (empty || value.length > 0)
    && value.every(string)
    && new Set(value).size === value.length;
}

function normalize(value) {
  try {
    return normalizeCanonicalJsonValue(value);
  } catch {
    throw new Error('art_provider_capability_json_value_invalid');
  }
}

export function validateArtProviderCapability(value) {
  value = normalize(value);
  const fields = [
    'schema', 'providerId', 'providerVersion', 'availability', 'privacy', 'runtime',
    'license', 'lastVerifiedAt', 'maxWidth', 'maxHeight', 'inputKinds', 'outputKinds',
    'localities', 'determinism', 'reproducibility', 'supports', 'capabilities', 'operators',
  ];
  if (!exact(value, fields)
      || value.schema !== 'eve-atelier-provider-capability/v2'
      || !string(value.providerId)
      || !string(value.providerVersion)
      || !['AVAILABLE', 'UNAVAILABLE'].includes(value.availability)
      || !['LOCAL', 'REMOTE_PRIVATE', 'REMOTE_PUBLIC'].includes(value.privacy)
      || !exact(value.runtime, ['kind', 'name', 'version'])
      || !string(value.runtime.kind)
      || !string(value.runtime.name)
      || !string(value.runtime.version)
      || !exact(value.license, ['spdx', 'boundary'])
      || !string(value.license.spdx)
      || !['LIBRARY', 'EXTERNAL_PROVIDER', 'REFERENCE'].includes(value.license.boundary)
      || !isCanonicalInstant(value.lastVerifiedAt)
      || !Number.isSafeInteger(value.maxWidth)
      || value.maxWidth < 1
      || !Number.isSafeInteger(value.maxHeight)
      || value.maxHeight < 1
      || !strings(value.inputKinds)
      || !strings(value.outputKinds)
      || !strings(value.localities)
      || !['DETERMINISTIC', 'SEEDED_STOCHASTIC', 'PROVIDER_DEPENDENT'].includes(value.determinism)
      || !['EXACT', 'BEST_EFFORT', 'SEEDED', 'UNKNOWN'].includes(value.reproducibility)
      || !exact(value.supports, ['alpha', 'layers', 'structure', 'references', 'seed', 'batch'])
      || Object.values(value.supports).some(item => typeof item !== 'boolean')
      || !strings(value.capabilities, { empty: true })
      || !isDenseJsonArray(value.operators)
      || value.operators.length === 0) {
    return { ok: false, reason: 'art_provider_capability_invalid' };
  }
  const seen = new Set();
  for (const operator of value.operators) {
    if (!exact(operator, ['operatorId', 'versions', 'evidenceLevel', 'costRank', 'latencyRank'])
        || !string(operator.operatorId)
        || !strings(operator.versions)
        || !(operator.evidenceLevel in evidenceRank)
        || !Number.isFinite(operator.costRank)
        || operator.costRank < 0
        || !Number.isFinite(operator.latencyRank)
        || operator.latencyRank < 0) {
      return { ok: false, reason: 'art_provider_operator_invalid' };
    }
    if (seen.has(operator.operatorId)) {
      return { ok: false, reason: `art_provider_operator_duplicate:${operator.operatorId}` };
    }
    seen.add(operator.operatorId);
  }
  return { ok: true };
}

export function matchArtProviderCapability({ manifests, operatorRef, requirements } = {}) {
  if (!Array.isArray(manifests) || manifests.length === 0) {
    throw new TypeError('art_provider_manifests_required');
  }
  if (!exact(operatorRef, ['operatorId', 'version'])
      || !string(operatorRef.operatorId)
      || !string(operatorRef.version)) {
    throw new TypeError('art_provider_operator_ref_required');
  }
  const requiredFields = [
    'allowedPrivacy', 'inputKind', 'outputKind', 'locality', 'width', 'height',
    'requiredSupports', 'requiredCapabilities', 'allowedDeterminism',
    'allowedReproducibility', 'allowedLicenseSpdx', 'allowedLicenseBoundaries',
    'verifiedAtOrAfter',
  ];
  if (!exact(requirements, requiredFields)
      || !strings(requirements.allowedPrivacy)
      || !string(requirements.inputKind)
      || !string(requirements.outputKind)
      || !string(requirements.locality)
      || !Number.isSafeInteger(requirements.width)
      || requirements.width < 1
      || !Number.isSafeInteger(requirements.height)
      || requirements.height < 1
      || !strings(requirements.requiredSupports, { empty: true })
      || !strings(requirements.requiredCapabilities, { empty: true })
      || !strings(requirements.allowedDeterminism)
      || !strings(requirements.allowedReproducibility)
      || !strings(requirements.allowedLicenseSpdx)
      || !strings(requirements.allowedLicenseBoundaries)
      || !isCanonicalInstant(requirements.verifiedAtOrAfter)) {
    throw new TypeError('art_provider_requirements_invalid');
  }
  const candidates = [];
  for (const raw of manifests) {
    const validation = validateArtProviderCapability(raw);
    if (!validation.ok) throw new Error(validation.reason);
    const manifest = normalize(raw);
    const capability = manifest.operators.find(item => (
      item.operatorId === operatorRef.operatorId && item.versions.includes(operatorRef.version)
    ));
    if (!capability
        || manifest.availability !== 'AVAILABLE'
        || !requirements.allowedPrivacy.includes(manifest.privacy)
        || !manifest.inputKinds.includes(requirements.inputKind)
        || !manifest.outputKinds.includes(requirements.outputKind)
        || !manifest.localities.includes(requirements.locality)
        || requirements.width > manifest.maxWidth
        || requirements.height > manifest.maxHeight
        || requirements.requiredSupports.some(name => manifest.supports[name] !== true)
        || requirements.requiredCapabilities.some(name => !manifest.capabilities.includes(name))
        || !requirements.allowedDeterminism.includes(manifest.determinism)
        || !requirements.allowedReproducibility.includes(manifest.reproducibility)
        || !requirements.allowedLicenseSpdx.includes(manifest.license.spdx)
        || !requirements.allowedLicenseBoundaries.includes(manifest.license.boundary)
        || Date.parse(manifest.lastVerifiedAt) < Date.parse(requirements.verifiedAtOrAfter)) {
      continue;
    }
    candidates.push({ manifest, capability });
  }
  candidates.sort((left, right) => (
    evidenceRank[right.capability.evidenceLevel] - evidenceRank[left.capability.evidenceLevel]
    || left.capability.latencyRank - right.capability.latencyRank
    || left.capability.costRank - right.capability.costRank
    || left.manifest.providerId.localeCompare(right.manifest.providerId)
  ));
  if (candidates.length === 0) throw new Error('no_compatible_art_provider');
  return structuredClone(candidates[0].manifest);
}

export function projectArtCapabilityToV1(manifest) {
  const validation = validateArtProviderCapability(manifest);
  if (!validation.ok) throw new Error(validation.reason);
  return {
    schema: 'eve-atelier-provider-capability/v1',
    providerId: manifest.providerId,
    providerVersion: manifest.providerVersion,
    availability: manifest.availability,
    privacy: manifest.privacy,
    capabilities: [...manifest.capabilities],
    operators: manifest.operators.map(item => ({
      operatorId: item.operatorId,
      versions: [...item.versions],
      evidenceLevel: item.evidenceLevel,
      costRank: item.costRank,
      latencyRank: item.latencyRank,
    })),
  };
}

export function chooseFallbackDecision({
  failureClass,
  alternativeProviderAvailable,
  localRepairAvailable,
  stochastic,
} = {}) {
  if (typeof failureClass !== 'string' || failureClass.length === 0
      || typeof alternativeProviderAvailable !== 'boolean'
      || typeof localRepairAvailable !== 'boolean'
      || typeof stochastic !== 'boolean') {
    throw new TypeError('fallback_decision_input_invalid');
  }
  if (failureClass === 'QUALITY_FAILURE' && localRepairAvailable) return 'REPAIR';
  if (failureClass === 'QUALITY_FAILURE' && stochastic) return 'RESAMPLE';
  if (['PROVIDER_UNAVAILABLE', 'TIMEOUT'].includes(failureClass)
      && alternativeProviderAvailable) return 'REBIND';
  if (failureClass === 'PROVIDER_FAMILY_MISMATCH') return 'SWITCH_BACKEND';
  if (['PRECONDITION_FAILED', 'CONSTRAINT_FAILURE'].includes(failureClass)) {
    return 'RECOMPILE_REQUEST';
  }
  return 'ASK_HUMAN';
}
