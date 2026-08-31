import {
  validateOperatorInvocation,
  validateProviderCapabilityManifest,
} from './contracts.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const evidenceRank = Object.freeze({
  PRODUCTION_OBSERVED: 5,
  RIGHTS_CLEAR_REAL: 4,
  PRIVATE_RESEARCH_AUTHORIZED: 3,
  CONTRACT_TESTED: 2,
  FIXTURE: 1,
});

function providerOperator(manifest, operator) {
  return manifest.operators.find(capability => (
    capability.operatorId === operator.operatorId
    && capability.versions.includes(operator.version)
  ));
}

export function matchProviderCapability({ manifests, operator, policy } = {}) {
  if (!Array.isArray(manifests) || manifests.length === 0) {
    throw new TypeError('provider_manifests_required');
  }
  if (!operator || typeof operator !== 'object') throw new TypeError('operator_definition_required');
  if (!policy || typeof policy !== 'object'
      || !Array.isArray(policy.allowedPrivacy)
      || !Array.isArray(policy.requiredCapabilities)) {
    throw new TypeError('provider_policy_required');
  }
  const unknownPolicyField = Object.keys(policy)
    .find(key => !['allowedPrivacy', 'requiredCapabilities'].includes(key));
  if (unknownPolicyField) throw new Error(`provider_policy_field_forbidden:${unknownPolicyField}`);
  for (const manifest of manifests) {
    const validation = validateProviderCapabilityManifest(manifest);
    if (!validation.ok) throw new Error(`invalid_provider_manifest:${validation.reason}`);
  }
  const requiredCapabilities = new Set([
    ...operator.requiredCapabilities,
    ...policy.requiredCapabilities,
  ]);
  const candidates = manifests.flatMap(manifest => {
    if (manifest.availability !== 'AVAILABLE'
        || !policy.allowedPrivacy.includes(manifest.privacy)
        || [...requiredCapabilities].some(capability => !manifest.capabilities.includes(capability))) {
      return [];
    }
    const capability = providerOperator(manifest, operator);
    return capability ? [{ manifest, capability }] : [];
  });
  candidates.sort((left, right) => (
    evidenceRank[right.capability.evidenceLevel] - evidenceRank[left.capability.evidenceLevel]
    || left.capability.latencyRank - right.capability.latencyRank
    || left.capability.costRank - right.capability.costRank
    || left.manifest.providerId.localeCompare(right.manifest.providerId)
  ));
  if (candidates.length === 0) throw new Error('no_compatible_provider');
  return structuredClone(candidates[0].manifest);
}

export function validateInvocationContract(value) {
  return validateOperatorInvocation(value);
}

function parameterValueValid(value, definition) {
  if (definition.kind === 'INTEGER' && !Number.isInteger(value)) return false;
  if (definition.kind === 'NUMBER' && !Number.isFinite(value)) return false;
  if (definition.kind === 'STRING' && (typeof value !== 'string' || value.length === 0)) return false;
  if (definition.kind === 'BOOLEAN' && typeof value !== 'boolean') return false;
  if (definition.kind === 'NUMBER_ARRAY'
      && (!Array.isArray(value) || value.length === 0 || value.some(item => !Number.isFinite(item)))) {
    return false;
  }
  if (definition.min !== undefined) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some(item => item < definition.min || item > definition.max)) return false;
  }
  return true;
}

function validateParameters(params, schema, operatorId) {
  const definitions = new Map(schema.map(definition => [definition.name, definition]));
  const unknown = Object.keys(params).find(name => !definitions.has(name));
  if (unknown) throw new Error(`operator_parameter_unknown:${operatorId}:${unknown}`);
  const missing = schema.find(definition => definition.required && !(definition.name in params));
  if (missing) throw new Error(`operator_parameter_required:${operatorId}:${missing.name}`);
  for (const [name, value] of Object.entries(params)) {
    if (!parameterValueValid(value, definitions.get(name))) {
      throw new Error(`operator_parameter_invalid:${operatorId}:${name}`);
    }
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export async function executeInvocation({
  store,
  manifests,
  providers,
  invocation,
  now = () => new Date().toISOString(),
} = {}) {
  const validation = validateOperatorInvocation(invocation);
  if (!validation.ok) throw new Error(validation.reason);
  if (!store || typeof store.getPack !== 'function' || typeof store.getStatus !== 'function') {
    throw new TypeError('operator_registry_store_required');
  }
  if (!Array.isArray(providers)) throw new TypeError('provider_objects_required');
  const pack = store.getPack(invocation.packRef);
  if (store.getStatus(invocation.packRef) !== 'ACTIVE') throw new Error('operator_pack_not_active');
  const operator = pack.families
    .flatMap(family => family.variants)
    .find(variant => variant.operatorId === invocation.operatorRef.operatorId
      && variant.version === invocation.operatorRef.version);
  if (!operator) throw new Error('operator_invocation_operator_not_found');
  if (operator.executionMode !== 'PROVIDER_BOUND') throw new Error('operator_not_provider_bound');
  if (operator.authority !== 'CANDIDATE_ONLY' && operator.authority !== 'OBSERVATION_ONLY') {
    throw new Error('operator_execution_authority_forbidden');
  }
  validateParameters(invocation.params, operator.parameterSchema, operator.operatorId);
  const selected = matchProviderCapability({
    manifests,
    operator,
    policy: invocation.providerPolicy,
  });
  const provider = providers.find(candidate => (
    candidate.providerId === selected.providerId
    && candidate.providerVersion === selected.providerVersion
  ));
  if (!provider || typeof provider.execute !== 'function') throw new Error('provider_object_identity_mismatch');

  const startedAt = now();
  const result = await provider.execute({
    operatorId: operator.operatorId,
    input: invocation.input,
    output: invocation.output,
    params: structuredClone(invocation.params),
  });
  if (result.providerId !== selected.providerId
      || result.providerVersion !== selected.providerVersion
      || result.operatorId !== operator.operatorId) {
    throw new Error('provider_receipt_identity_mismatch');
  }
  const finishedAt = now();
  const receipt = {
    schema: 'eve-atelier-operator-execution-receipt/v1',
    executionId: `execution:${invocation.operationId}`,
    operationId: invocation.operationId,
    packRef: structuredClone(invocation.packRef),
    operatorRef: structuredClone(invocation.operatorRef),
    target: structuredClone(invocation.target),
    expectedRevision: invocation.expectedRevision,
    providerRef: {
      providerId: selected.providerId,
      providerVersion: selected.providerVersion,
    },
    inputRefs: [invocation.input],
    outputRefs: [invocation.output],
    startedAt,
    finishedAt,
    status: 'completed',
    reproducibility: operator.determinism === 'DETERMINISTIC'
      ? 'exact'
      : operator.determinism === 'SEEDED_STOCHASTIC'
        ? 'seeded_stochastic'
        : 'non_reproducible',
    metadata: structuredClone(result.metadata ?? {}),
  };
  const capability = selected.operators.find(item => (
    item.operatorId === operator.operatorId && item.versions.includes(operator.version)
  ));
  store.appendExperience({
    schema: 'eve-atelier-operator-experience-event/v1',
    eventId: `experience:${invocation.operationId}`,
    packRef: structuredClone(invocation.packRef),
    operatorRef: structuredClone(invocation.operatorRef),
    providerRef: structuredClone(receipt.providerRef),
    semanticContext: { axisChanges: [], lockIds: [] },
    inputHashes: [sha256(invocation.input)],
    outputHashes: [sha256(invocation.output)],
    outcome: 'COMPLETED',
    evaluationRefs: [],
    evidenceClass: capability.evidenceLevel,
    occurredAt: finishedAt,
  });
  return receipt;
}
