import {
  validateOperatorInvocation,
  validateProviderCapabilityManifest,
} from './contracts.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const evidenceRank = Object.freeze({
  PRODUCTION_OBSERVED: 5,
  RIGHTS_CLEAR_REAL: 4,
  PRIVATE_RESEARCH_AUTHORIZED: 3,
  CONTRACT_TESTED: 2,
  FIXTURE: 1,
});
const providerResultFields = Object.freeze([
  'providerId', 'providerVersion', 'operationId', 'packRef', 'operatorRef', 'operatorId',
  'inputArtifactId', 'outputArtifactId', 'output', 'outputSha256', 'metadata',
]);

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

function containsLocalPath(value) {
  if (typeof value === 'string') {
    return /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|users|var|tmp|opt)\/)/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsLocalPath);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(containsLocalPath);
}

function validateReceiptMetadata(metadata, schema, operatorId) {
  const value = metadata ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`provider_receipt_metadata_invalid:${operatorId}`);
  }
  const definitions = new Map(schema.map(definition => [definition.name, definition]));
  const unknown = Object.keys(value).find(name => !definitions.has(name));
  if (unknown) throw new Error(`provider_receipt_metadata_field_forbidden:${unknown}`);
  const missing = schema.find(definition => definition.required && !(definition.name in value));
  if (missing) throw new Error(`provider_receipt_metadata_required:${missing.name}`);
  if (containsLocalPath(value)) throw new Error('provider_receipt_metadata_local_path_forbidden');
  for (const [name, item] of Object.entries(value)) {
    if (!parameterValueValid(item, definitions.get(name))) {
      throw new Error(`provider_receipt_metadata_value_invalid:${name}`);
    }
  }
  return Object.fromEntries(schema
    .filter(definition => definition.name in value)
    .map(definition => [definition.name, structuredClone(value[definition.name]) ]));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function failureClass(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(':', 1)[0] || 'provider_execution_failed';
}

function runtimeExperience({
  invocation,
  providerRef,
  eventId,
  inputSha256,
  outputHashes,
  outcome,
  occurredAt,
  failure,
}) {
  const event = {
    schema: 'eve-atelier-operator-experience-event/v1',
    eventId,
    operationId: invocation.operationId,
    packRef: structuredClone(invocation.packRef),
    operatorRef: structuredClone(invocation.operatorRef),
    providerRef: structuredClone(providerRef),
    semanticContext: { axisChanges: [], lockIds: [] },
    inputHashes: [inputSha256],
    outputHashes,
    outcome,
    evaluationRefs: [],
    evidenceClass: 'CONTRACT_TESTED',
    provenance: { kind: 'RUNTIME', id: 'operator-runtime:v1' },
    occurredAt,
  };
  if (failure !== undefined) event.failureClass = failure;
  return event;
}

export async function executeInvocation({
  store,
  manifests,
  providers,
  invocation,
  now = () => new Date().toISOString(),
  revisionGuard,
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
  if (existsSync(invocation.output)) throw new Error('operator_output_must_not_exist');
  if (typeof revisionGuard !== 'function') throw new TypeError('revision_guard_required');
  const revision = await revisionGuard({
    target: structuredClone(invocation.target),
    expectedRevision: invocation.expectedRevision,
  });
  if (!revision?.ok) throw new Error(revision?.reason ?? 'revision_validation_failed');
  if (typeof revision.evidenceRef !== 'string' || revision.evidenceRef.length === 0) {
    throw new Error('revision_validation_evidence_required');
  }
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

  const inputSha256 = sha256(invocation.input);
  const startedAt = now();
  const providerRef = {
    providerId: selected.providerId,
    providerVersion: selected.providerVersion,
  };
  store.appendExperience(runtimeExperience({
    invocation,
    providerRef,
    eventId: `experience:${invocation.operationId}:prepared`,
    inputSha256,
    outputHashes: [],
    outcome: 'PREPARED',
    occurredAt: startedAt,
  }), { providerManifest: selected });
  let result;
  let outputSha256;
  let metadata;
  try {
    result = await provider.execute({
      operationId: invocation.operationId,
      packRef: structuredClone(invocation.packRef),
      operatorRef: structuredClone(invocation.operatorRef),
      operatorId: operator.operatorId,
      inputArtifactId: invocation.inputArtifactId,
      outputArtifactId: invocation.outputArtifactId,
      input: invocation.input,
      output: invocation.output,
      params: structuredClone(invocation.params),
    });
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('provider_result_invalid');
    }
    const unknownResultField = Object.keys(result)
      .find(key => !providerResultFields.includes(key));
    if (unknownResultField) throw new Error(`provider_result_field_forbidden:${unknownResultField}`);
    if (result.providerId !== selected.providerId
        || result.providerVersion !== selected.providerVersion
        || result.operationId !== invocation.operationId
        || result.packRef?.packId !== invocation.packRef.packId
        || result.packRef?.version !== invocation.packRef.version
        || result.packRef?.digest !== invocation.packRef.digest
        || result.operatorRef?.operatorId !== invocation.operatorRef.operatorId
        || result.operatorRef?.version !== invocation.operatorRef.version
        || result.inputArtifactId !== invocation.inputArtifactId
        || result.outputArtifactId !== invocation.outputArtifactId
        || result.output !== invocation.output) {
      throw new Error('provider_receipt_identity_mismatch');
    }
    if (!existsSync(invocation.output)) throw new Error('provider_output_missing');
    outputSha256 = sha256(invocation.output);
    if (result.outputSha256 !== outputSha256) throw new Error('provider_output_hash_mismatch');
    metadata = validateReceiptMetadata(
      result.metadata,
      operator.receiptMetadataSchema,
      operator.operatorId,
    );
  } catch (error) {
    const outputHashes = existsSync(invocation.output) ? [sha256(invocation.output)] : [];
    store.appendExperience(runtimeExperience({
      invocation,
      providerRef,
      eventId: `experience:${invocation.operationId}:failed`,
      inputSha256,
      outputHashes,
      outcome: 'FAILED',
      occurredAt: now(),
      failure: failureClass(error),
    }), { providerManifest: selected });
    throw error;
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
    revisionValidation: {
      status: 'VERIFIED',
      evidenceRef: revision.evidenceRef,
    },
    providerRef,
    inputArtifacts: [{ artifactId: invocation.inputArtifactId, sha256: inputSha256 }],
    outputArtifacts: [{ artifactId: invocation.outputArtifactId, sha256: outputSha256 }],
    startedAt,
    finishedAt,
    status: 'completed',
    reproducibility: operator.determinism === 'DETERMINISTIC'
      ? 'exact'
      : operator.determinism === 'SEEDED_STOCHASTIC'
        ? 'seeded_stochastic'
        : 'non_reproducible',
    metadata,
  };
  store.appendExperience(runtimeExperience({
    invocation,
    providerRef,
    eventId: `experience:${invocation.operationId}:completed`,
    inputSha256,
    outputHashes: [outputSha256],
    outcome: 'COMPLETED',
    occurredAt: finishedAt,
  }), { providerManifest: selected });
  return receipt;
}
