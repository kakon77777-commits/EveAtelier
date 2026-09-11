import {
  isDenseJsonArray,
  isPlainJsonObject,
  normalizeCanonicalJsonValue,
} from '../operator-runtime/json-values.js';
import { canonicalJson } from '../operator-runtime/canonical.js';
import { isCanonicalInstant } from '../operator-runtime/time.js';
import { validateArtActor, validateAssetRef } from '../art-domain/contracts.js';
import { createHash } from 'node:crypto';

export const AADS_TASK_TYPES = Object.freeze([
  'BACKGROUND_REMOVAL',
  'RELIGHT',
  'RECOLOR',
  'RESIZE',
  'COMPOSITE',
  'UNKNOWN',
]);

export const AADS_DECISIONS = Object.freeze([
  'ACCEPT',
  'REPAIR',
  'RESAMPLE',
  'REBIND',
  'RECOMPILE',
  'SWITCH_BACKEND',
  'ASK_HUMAN',
  'STOP',
]);

export const CONSTRAINT_DIMENSIONS = Object.freeze([
  'IDENTITY',
  'STRUCTURE',
  'STYLE',
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

const constraintStrengths = Object.freeze(['HARD', 'STRONG', 'MEDIUM', 'SOFT', 'PREFERENCE']);
const constraintModes = Object.freeze(['PRESERVE', 'REMOVE', 'SET', 'AVOID', 'MINIMIZE', 'MAXIMIZE']);
const referenceRoles = Object.freeze([
  'POSITIVE_STYLE', 'NEGATIVE', 'IDENTITY', 'COLOR', 'LIGHTING', 'STRUCTURE',
]);
const sessionActions = Object.freeze([
  'PLAN', 'EXECUTE', 'EVALUATE', 'REQUEST_HUMAN', 'PROMOTE', 'STOP',
]);
const sessionEventTypes = Object.freeze([
  'SESSION_STARTED',
  'NODE_STARTED',
  'NODE_SUCCEEDED',
  'NODE_FAILED',
  'HUMAN_GATE_WAITING',
  'HUMAN_DECISION',
  'SESSION_COMPLETED',
  'SESSION_STOPPED',
  'SESSION_FAILED',
]);
const contextSections = Object.freeze([
  'GLOSSARY', 'OPERATORS', 'DOCUMENTS', 'SESSIONS', 'EVIDENCE', 'AUTHORITIES',
]);
const absolutePath = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|users|var|tmp|opt)\/)/i;
const secret = /(?:BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,})/i;
const implementationKey = /(?:providerId|providerVersion|model|prompt|checkpoint|workflow|backend|localPath|filePath|secret|credential|bearerToken)/i;
const sessionImplementationKey = /(?:providerId|providerVersion|model|checkpoint|backend|localPath|filePath|secret|credential|bearerToken)/i;

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

function finite(value, { min = 0 } = {}) {
  return Number.isFinite(value) && value >= min;
}

function result(reason = null) {
  return reason === null ? { ok: true } : { ok: false, reason };
}

function safeValue(value, { rejectImplementationKeys = false } = {}) {
  if (typeof value === 'string') return !absolutePath.test(value) && !secret.test(value);
  if (Array.isArray(value)) return value.every(item => safeValue(item, { rejectImplementationKeys }));
  if (!object(value)) return value === null || typeof value === 'boolean' || Number.isFinite(value);
  return Object.entries(value).every(([key, item]) => (
    (!rejectImplementationKeys || !implementationKey.test(key))
    && safeValue(item, { rejectImplementationKeys })
  ));
}

function containsKey(value, pattern) {
  if (Array.isArray(value)) return value.some(item => containsKey(item, pattern));
  if (!object(value)) return false;
  return Object.entries(value).some(([key, item]) => pattern.test(key) || containsKey(item, pattern));
}

function actor(value, kinds = ['HUMAN', 'AI', 'SYSTEM']) {
  return validateArtActor(value, kinds);
}

function packRef(value) {
  return exact(value, ['packId', 'version', 'digest'])
    && string(value.packId)
    && string(value.version)
    && /^[a-f0-9]{64}$/.test(value.digest);
}

function operatorRef(value) {
  return exact(value, ['operatorId', 'version'])
    && string(value.operatorId)
    && value.operatorId.startsWith('visual.op.')
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version);
}

export function normalizeVisualValue(value, reason = 'visual_intelligence_json_value_invalid') {
  try {
    return normalizeCanonicalJsonValue(value);
  } catch {
    throw new Error(reason);
  }
}

export function cloneVisualValue(value) {
  return JSON.parse(canonicalJson(value));
}

export function validateVisualIntent(value) {
  if (!exact(value, [
    'schema', 'intentId', 'projectId', 'documentId', 'text', 'taskTypeHint',
    'references', 'preferences', 'hardConstraints', 'overrides', 'submittedBy',
    'submittedAt',
  ])) return result('aads_visual_intent_invalid');
  if (value.schema !== 'eve-atelier-visual-intent/v1'
      || !string(value.intentId)
      || !string(value.projectId)
      || !string(value.documentId)
      || !string(value.text)
      || !AADS_TASK_TYPES.includes(value.taskTypeHint)
      || !isDenseJsonArray(value.references)
      || !isDenseJsonArray(value.preferences)
      || !isDenseJsonArray(value.hardConstraints)
      || !isDenseJsonArray(value.overrides)
      || !actor(value.submittedBy, ['HUMAN'])
      || !isCanonicalInstant(value.submittedAt)
      || !safeValue(value.text)) return result('aads_visual_intent_invalid');
  const referenceIds = new Set();
  for (const reference of value.references) {
    if (!exact(reference, ['referenceId', 'assetRef', 'role', 'appliesTo'])
        || !string(reference.referenceId)
        || referenceIds.has(reference.referenceId)
        || !validateAssetRef(reference.assetRef).ok
        || !referenceRoles.includes(reference.role)
        || !strings(reference.appliesTo, { allowed: CONSTRAINT_DIMENSIONS })) {
      return result('aads_visual_intent_reference_invalid');
    }
    referenceIds.add(reference.referenceId);
  }
  for (const preference of value.preferences) {
    if (!exact(preference, ['kind', 'subjectRef', 'reason'])
        || !['LIKE', 'DISLIKE'].includes(preference.kind)
        || !string(preference.subjectRef)
        || !string(preference.reason)
        || !safeValue(preference)) return result('aads_visual_intent_preference_invalid');
  }
  for (const constraint of value.hardConstraints) {
    if (!exact(constraint, ['dimension', 'requirement'])
        || !CONSTRAINT_DIMENSIONS.includes(constraint.dimension)
        || !string(constraint.requirement)
        || !safeValue(constraint)) return result('aads_visual_intent_hard_constraint_invalid');
  }
  for (const override of value.overrides) {
    if (!exact(override, ['scope', 'instruction', 'actor'])
        || !string(override.scope)
        || !string(override.instruction)
        || !actor(override.actor, ['HUMAN'])
        || !safeValue(override)) return result('aads_visual_intent_override_invalid');
  }
  return result();
}

export function validateConstraintPacket(value) {
  if (!exact(value, [
    'schema', 'packetId', 'intentId', 'projectId', 'documentId', 'taskType',
    'constraints', 'referenceDirections', 'providerPolicy', 'evaluationPolicy',
    'requiresHumanClarification', 'compiler', 'compiledAt',
  ])) return result('aads_constraint_packet_invalid');
  if (value.schema !== 'eve-atelier-constraint-packet/v1'
      || !string(value.packetId)
      || !string(value.intentId)
      || !string(value.projectId)
      || !string(value.documentId)
      || !AADS_TASK_TYPES.includes(value.taskType)
      || !isDenseJsonArray(value.constraints)
      || !isDenseJsonArray(value.referenceDirections)
      || !exact(value.providerPolicy, [
        'allowedPrivacy', 'requireLocal', 'maxCostUnits', 'maxLatencyMs',
      ])
      || !strings(value.providerPolicy.allowedPrivacy, {
        allowed: ['LOCAL', 'REMOTE_PRIVATE', 'REMOTE_PUBLIC'],
      })
      || typeof value.providerPolicy.requireLocal !== 'boolean'
      || !finite(value.providerPolicy.maxCostUnits)
      || !integer(value.providerPolicy.maxLatencyMs)
      || !exact(value.evaluationPolicy, ['requiredDimensions', 'humanReview'])
      || !strings(value.evaluationPolicy.requiredDimensions, {
        allowed: CONSTRAINT_DIMENSIONS,
      })
      || typeof value.evaluationPolicy.humanReview !== 'boolean'
      || typeof value.requiresHumanClarification !== 'boolean'
      || !exact(value.compiler, ['id', 'version'])
      || !string(value.compiler.id)
      || !string(value.compiler.version)
      || !isCanonicalInstant(value.compiledAt)) return result('aads_constraint_packet_invalid');
  const constraintIds = new Set();
  for (const constraint of value.constraints) {
    if (!exact(constraint, [
      'constraintId', 'dimension', 'strength', 'mode', 'value', 'sourceRef',
    ])
        || !string(constraint.constraintId)
        || constraintIds.has(constraint.constraintId)
        || !CONSTRAINT_DIMENSIONS.includes(constraint.dimension)
        || !constraintStrengths.includes(constraint.strength)
        || !constraintModes.includes(constraint.mode)
        || !string(constraint.sourceRef)
        || !safeValue(constraint.value, { rejectImplementationKeys: true })) {
      return result('aads_constraint_invalid');
    }
    constraintIds.add(constraint.constraintId);
  }
  if (value.taskType !== 'UNKNOWN' && value.constraints.length === 0) {
    return result('aads_constraints_required');
  }
  if (value.taskType === 'UNKNOWN' && !value.requiresHumanClarification) {
    return result('aads_unknown_intent_must_require_human');
  }
  const directionIds = new Set();
  for (const direction of value.referenceDirections) {
    if (!exact(direction, ['directionId', 'assetRef', 'role', 'appliesTo'])
        || !string(direction.directionId)
        || directionIds.has(direction.directionId)
        || !validateAssetRef(direction.assetRef).ok
        || !referenceRoles.includes(direction.role)
        || !strings(direction.appliesTo, { allowed: CONSTRAINT_DIMENSIONS })) {
      return result('aads_reference_direction_invalid');
    }
    directionIds.add(direction.directionId);
  }
  return result();
}

export function validateOperatorPlan(value) {
  if (!exact(value, [
    'schema', 'planId', 'packetId', 'packRef', 'taskType', 'steps',
    'decisionPolicy', 'createdAt',
  ])) return result('aads_operator_plan_invalid');
  if (value.schema !== 'eve-atelier-operator-plan/v1'
      || !string(value.planId)
      || !string(value.packetId)
      || !packRef(value.packRef)
      || !AADS_TASK_TYPES.includes(value.taskType)
      || !isDenseJsonArray(value.steps)
      || !strings(value.decisionPolicy, { allowed: AADS_DECISIONS })
      || !isCanonicalInstant(value.createdAt)) return result('aads_operator_plan_invalid');
  const stepIds = new Set();
  for (const step of value.steps) {
    if (!exact(step, ['stepId', 'operatorRef', 'purpose', 'targetRole', 'outputRole'])
        || !string(step.stepId)
        || stepIds.has(step.stepId)
        || !operatorRef(step.operatorRef)
        || !string(step.purpose)
        || !string(step.targetRole)
        || !string(step.outputRole)) return result('aads_operator_plan_step_invalid');
    stepIds.add(step.stepId);
  }
  if (value.taskType !== 'UNKNOWN' && value.steps.length === 0) {
    return result('aads_operator_plan_steps_required');
  }
  if (value.taskType === 'UNKNOWN' && value.steps.length !== 0) {
    return result('aads_unknown_operator_plan_must_be_empty');
  }
  return result();
}

function providerPolicy(value) {
  return exact(value, [
    'allowedPrivacy', 'requiredSupports', 'allowedLicenseSpdx',
    'allowedLicenseBoundaries', 'verifiedAtOrAfter',
  ])
    && strings(value.allowedPrivacy, { allowed: ['LOCAL', 'REMOTE_PRIVATE', 'REMOTE_PUBLIC'] })
    && strings(value.requiredSupports, { empty: true })
    && strings(value.allowedLicenseSpdx)
    && strings(value.allowedLicenseBoundaries)
    && isCanonicalInstant(value.verifiedAtOrAfter);
}

function targetBinding(value) {
  return exact(value, ['kind', 'nodeId'])
    && ['INITIAL', 'NODE_CANDIDATE', 'LATEST_CANDIDATE'].includes(value.kind)
    && (value.kind === 'INITIAL' ? value.nodeId === null : string(value.nodeId));
}

function nodeOutputBinding(value) {
  return exact(value, ['kind', 'nodeId'])
    && value.kind === 'NODE_OUTPUT'
    && string(value.nodeId);
}

function boundValue(value) {
  if (exact(value, ['$ref', 'nodeId', 'path'])) {
    return value.$ref === 'NODE_OUTPUT'
      && string(value.nodeId)
      && ['asset.assetId', 'candidateVersionId', 'evaluationId', 'reviewId'].includes(value.path);
  }
  if (Array.isArray(value)) return value.every(boundValue);
  if (object(value)) {
    if ('$ref' in value) return false;
    return Object.entries(value).every(([key, item]) => (
      !implementationKey.test(key) && boundValue(item)
    ));
  }
  return safeValue(value, { rejectImplementationKeys: true });
}

function workflowEdges(node) {
  if (node.kind === 'OPERATOR') {
    return [node.onSuccess, node.onFailure, ...node.fallback.map(item => item.nodeId)]
      .filter(item => item !== null);
  }
  if (node.kind === 'EVALUATE') return [node.onAccept, node.onRepair, node.onReject];
  if (node.kind === 'HUMAN_GATE') return [node.onApprove, node.onReject];
  if (node.kind === 'PROMOTE') return [node.onSuccess, node.onFailure];
  return [];
}

function parameterBindings(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) parameterBindings(item, result);
    return result;
  }
  if (!object(value)) return result;
  if (value.$ref === 'NODE_OUTPUT') {
    result.push({ nodeId: value.nodeId, path: value.path });
    return result;
  }
  for (const item of Object.values(value)) parameterBindings(item, result);
  return result;
}

function workflowBindings(node) {
  const bindings = [];
  if (node.kind === 'OPERATOR') {
    if (node.targetBinding.kind !== 'INITIAL') {
      bindings.push({ nodeId: node.targetBinding.nodeId, path: 'candidateVersionId' });
    }
    bindings.push(...parameterBindings(node.params));
  } else if (node.kind === 'EVALUATE') {
    bindings.push({ nodeId: node.inputBinding.nodeId, path: 'candidateVersionId' });
  } else if (node.kind === 'HUMAN_GATE') {
    bindings.push({ nodeId: node.candidateBinding.nodeId, path: 'candidateVersionId' });
    bindings.push({ nodeId: node.evaluationBinding.nodeId, path: 'evaluationId' });
  } else if (node.kind === 'PROMOTE') {
    bindings.push({ nodeId: node.candidateBinding.nodeId, path: 'candidateVersionId' });
    bindings.push({ nodeId: node.evaluationBinding.nodeId, path: 'evaluationId' });
    if (node.reviewBinding !== null) {
      bindings.push({ nodeId: node.reviewBinding.nodeId, path: 'reviewId' });
    }
  }
  return bindings;
}

function bindingProducerValid(producer, path) {
  if (['asset.assetId', 'candidateVersionId'].includes(path)) {
    return producer.kind === 'OPERATOR'
      && (path !== 'candidateVersionId' || producer.commit.kind === 'CANDIDATE_VERSION');
  }
  if (path === 'evaluationId') return producer.kind === 'EVALUATE';
  if (path === 'reviewId') return producer.kind === 'HUMAN_GATE';
  return false;
}

function validateWorkflowNode(node) {
  if (!object(node) || !string(node.nodeId) || !integer(node.maxVisits, { min: 1, max: 100 })) {
    return false;
  }
  if (node.kind === 'OPERATOR') {
    if (!exact(node, [
      'nodeId', 'kind', 'maxVisits', 'operatorRef', 'targetBinding', 'params',
      'providerPolicy', 'output', 'commit', 'onSuccess', 'onFailure', 'fallback',
    ])
        || !operatorRef(node.operatorRef)
        || !targetBinding(node.targetBinding)
        || !object(node.params)
        || !boundValue(node.params)
        || !providerPolicy(node.providerPolicy)
        || !exact(node.output, ['mediaType', 'extension'])
        || !string(node.output.mediaType)
        || !string(node.output.extension)
        || !exact(node.commit, ['kind', 'outputRole'])
        || !['ASSET_ONLY', 'CANDIDATE_VERSION'].includes(node.commit.kind)
        || !string(node.commit.outputRole)
        || (node.onSuccess !== null && !string(node.onSuccess))
        || (node.onFailure !== null && !string(node.onFailure))
        || !isDenseJsonArray(node.fallback)) return false;
    const decisions = new Set();
    for (const edge of node.fallback) {
      if (!exact(edge, ['decision', 'nodeId'])
          || !AADS_DECISIONS.includes(edge.decision)
          || decisions.has(edge.decision)
          || !string(edge.nodeId)) return false;
      decisions.add(edge.decision);
    }
    return true;
  }
  if (node.kind === 'EVALUATE') {
    return exact(node, [
      'nodeId', 'kind', 'maxVisits', 'inputBinding', 'evaluatorRef',
      'onAccept', 'onRepair', 'onReject',
    ])
      && nodeOutputBinding(node.inputBinding)
      && exact(node.evaluatorRef, ['kind', 'id', 'version'])
      && ['DETERMINISTIC', 'HYBRID'].includes(node.evaluatorRef.kind)
      && string(node.evaluatorRef.id)
      && string(node.evaluatorRef.version)
      && [node.onAccept, node.onRepair, node.onReject].every(string);
  }
  if (node.kind === 'HUMAN_GATE') {
    return exact(node, [
      'nodeId', 'kind', 'maxVisits', 'candidateBinding', 'evaluationBinding',
      'prompt', 'onApprove', 'onReject',
    ])
      && nodeOutputBinding(node.candidateBinding)
      && nodeOutputBinding(node.evaluationBinding)
      && string(node.prompt)
      && safeValue(node.prompt)
      && string(node.onApprove)
      && string(node.onReject);
  }
  if (node.kind === 'PROMOTE') {
    return exact(node, [
      'nodeId', 'kind', 'maxVisits', 'candidateBinding', 'evaluationBinding',
      'reviewBinding', 'onSuccess', 'onFailure',
    ])
      && nodeOutputBinding(node.candidateBinding)
      && nodeOutputBinding(node.evaluationBinding)
      && (node.reviewBinding === null || nodeOutputBinding(node.reviewBinding))
      && string(node.onSuccess)
      && string(node.onFailure);
  }
  if (node.kind === 'STOP') {
    return exact(node, ['nodeId', 'kind', 'maxVisits', 'outcome'])
      && ['ACCEPTED', 'REJECTED', 'NEEDS_HUMAN', 'BUDGET_EXHAUSTED', 'FAILED'].includes(node.outcome);
  }
  return false;
}

export function validateRabclWorkflow(value) {
  if (!exact(value, [
    'schema', 'workflowId', 'version', 'planId', 'packetId', 'entryNodeId',
    'nodes', 'createdAt',
  ])) return result('rabcl_workflow_invalid');
  if (value.schema !== 'eve-atelier-rabcl-workflow/v1'
      || !string(value.workflowId)
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)
      || !string(value.planId)
      || !string(value.packetId)
      || !string(value.entryNodeId)
      || !isDenseJsonArray(value.nodes)
      || value.nodes.length === 0
      || !isCanonicalInstant(value.createdAt)) return result('rabcl_workflow_invalid');
  const nodeIds = new Set();
  for (const node of value.nodes) {
    if (!validateWorkflowNode(node) || nodeIds.has(node.nodeId)) {
      return result('rabcl_workflow_node_invalid');
    }
    nodeIds.add(node.nodeId);
  }
  if (!nodeIds.has(value.entryNodeId)) return result('rabcl_workflow_entry_missing');
  for (const node of value.nodes) {
    if (workflowEdges(node).some(edge => !nodeIds.has(edge))) {
      return result('rabcl_workflow_edge_dangling');
    }
    for (const binding of [
      node.targetBinding,
      node.inputBinding,
      node.candidateBinding,
      node.evaluationBinding,
      node.reviewBinding,
    ].filter(Boolean)) {
      if (binding.nodeId !== null && !nodeIds.has(binding.nodeId)) {
        return result('rabcl_workflow_binding_dangling');
      }
    }
  }
  const reachable = new Set();
  const queue = [value.entryNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = value.nodes.find(item => item.nodeId === nodeId);
    for (const edge of workflowEdges(node)) queue.push(edge);
  }
  if (reachable.size !== value.nodes.length) return result('rabcl_workflow_node_unreachable');
  if (!value.nodes.some(node => reachable.has(node.nodeId) && node.kind === 'STOP')) {
    return result('rabcl_workflow_terminal_unreachable');
  }
  const nodes = new Map(value.nodes.map(node => [node.nodeId, node]));
  const predecessors = new Map(value.nodes.map(node => [node.nodeId, []]));
  for (const node of value.nodes) {
    for (const edge of workflowEdges(node)) predecessors.get(edge).push(node.nodeId);
  }
  const all = new Set(nodeIds);
  const dominators = new Map(value.nodes.map(node => [
    node.nodeId,
    node.nodeId === value.entryNodeId ? new Set([node.nodeId]) : new Set(all),
  ]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of value.nodes) {
      if (node.nodeId === value.entryNodeId) continue;
      const preds = predecessors.get(node.nodeId);
      let intersection = new Set(all);
      for (const predecessor of preds) {
        intersection = new Set([...intersection]
          .filter(item => dominators.get(predecessor).has(item)));
      }
      intersection.add(node.nodeId);
      const previous = dominators.get(node.nodeId);
      if (previous.size !== intersection.size
          || [...previous].some(item => !intersection.has(item))) {
        dominators.set(node.nodeId, intersection);
        changed = true;
      }
    }
  }
  for (const consumer of value.nodes) {
    for (const binding of workflowBindings(consumer)) {
      const producer = nodes.get(binding.nodeId);
      if (binding.nodeId === consumer.nodeId
          || !bindingProducerValid(producer, binding.path)) {
        return result('rabcl_workflow_binding_producer_invalid');
      }
      if (!dominators.get(consumer.nodeId).has(binding.nodeId)) {
        return result('rabcl_workflow_binding_not_dominating');
      }
    }
  }
  return result();
}

export function validateAadsSession(value) {
  if (!exact(value, [
    'schema', 'sessionId', 'projectId', 'documentId', 'goal', 'taskType',
    'intentId', 'packetId', 'planId', 'workflowId', 'contextSnapshotId',
    'initialArtState', 'budget', 'authority', 'createdBy', 'createdAt',
  ])) return result('aads_session_invalid');
  if (value.schema !== 'eve-atelier-aads-visual-session/v1'
      || !string(value.sessionId)
      || !string(value.projectId)
      || !string(value.documentId)
      || !string(value.goal)
      || !safeValue(value.goal)
      || !AADS_TASK_TYPES.includes(value.taskType)
      || !string(value.intentId)
      || !string(value.packetId)
      || !string(value.planId)
      || !string(value.workflowId)
      || !string(value.contextSnapshotId)
      || !exact(value.initialArtState, [
        'versionId', 'currentVersionId', 'documentRevision', 'componentGraphDigest',
        'canvasRevision',
      ])
      || !string(value.initialArtState.versionId)
      || !string(value.initialArtState.currentVersionId)
      || !integer(value.initialArtState.documentRevision, { min: 1 })
      || !/^[a-f0-9]{64}$/.test(value.initialArtState.componentGraphDigest)
      || (value.initialArtState.canvasRevision !== null
        && !integer(value.initialArtState.canvasRevision))
      || !exact(value.budget, [
        'maxIterations', 'maxProviderCalls', 'maxCandidates', 'maxRepairLoops',
        'maxCostUnits', 'maxLatencyMs',
      ])
      || !integer(value.budget.maxIterations, { min: 1 })
      || !integer(value.budget.maxProviderCalls)
      || !integer(value.budget.maxCandidates)
      || !integer(value.budget.maxRepairLoops)
      || !finite(value.budget.maxCostUnits)
      || !integer(value.budget.maxLatencyMs)
      || !exact(value.authority, [
        'allowedActions', 'promotionMode', 'allowedDecisionKinds', 'grantedBy',
        'grantRef',
      ])
      || !strings(value.authority.allowedActions, { allowed: sessionActions })
      || !['FORBIDDEN', 'POLICY_GATED'].includes(value.authority.promotionMode)
      || !strings(value.authority.allowedDecisionKinds, { allowed: AADS_DECISIONS })
      || !actor(value.authority.grantedBy, ['HUMAN'])
      || !string(value.authority.grantRef)
      || !actor(value.createdBy, ['HUMAN'])
      || !isCanonicalInstant(value.createdAt)) return result('aads_session_invalid');
  if (value.authority.promotionMode === 'FORBIDDEN'
      && value.authority.allowedActions.includes('PROMOTE')) {
    return result('aads_session_promotion_authority_conflict');
  }
  return result();
}

export function validateContextSnapshot(value) {
  if (!exact(value, [
    'schema', 'contextSnapshotId', 'projectId', 'contextVersion', 'glossary',
    'operatorPackRefs', 'artDocuments', 'activeSessionRefs', 'evidenceRefs',
    'sourceAuthorities', 'createdAt',
  ])) return result('aads_context_snapshot_invalid');
  if (value.schema !== 'eve-atelier-project-context-snapshot/v1'
      || !string(value.contextSnapshotId)
      || !string(value.projectId)
      || !integer(value.contextVersion, { min: 1 })
      || !isDenseJsonArray(value.glossary)
      || !isDenseJsonArray(value.operatorPackRefs)
      || !isDenseJsonArray(value.artDocuments)
      || !strings(value.activeSessionRefs, { empty: true })
      || !strings(value.evidenceRefs, { empty: true })
      || !exact(value.sourceAuthorities, [
        'operatorRegistry', 'artDocumentStore', 'assetStore', 'semanticStore',
      ])
      || !string(value.sourceAuthorities.operatorRegistry)
      || !string(value.sourceAuthorities.artDocumentStore)
      || !string(value.sourceAuthorities.assetStore)
      || (value.sourceAuthorities.semanticStore !== null
        && !string(value.sourceAuthorities.semanticStore))
      || !isCanonicalInstant(value.createdAt)
      || !safeValue(value)) return result('aads_context_snapshot_invalid');
  const terms = new Set();
  for (const item of value.glossary) {
    if (!exact(item, ['term', 'meaning'])
        || !string(item.term)
        || terms.has(item.term)
        || !string(item.meaning)) return result('aads_context_glossary_invalid');
    terms.add(item.term);
  }
  if (value.operatorPackRefs.some(item => !packRef(item))) {
    return result('aads_context_operator_pack_invalid');
  }
  const documents = new Set();
  for (const item of value.artDocuments) {
    if (!exact(item, [
      'documentId', 'versionId', 'documentRevision', 'componentGraphDigest',
    ])
        || !string(item.documentId)
        || documents.has(item.documentId)
        || !string(item.versionId)
        || !integer(item.documentRevision, { min: 1 })
        || !/^[a-f0-9]{64}$/.test(item.componentGraphDigest)) {
      return result('aads_context_document_invalid');
    }
    documents.add(item.documentId);
  }
  return result();
}

export function validateWorkerProfile(value) {
  if (!exact(value, [
    'schema', 'profileId', 'purpose', 'allowedSections', 'maxEntriesPerSection',
    'createdAt',
  ])) return result('aads_worker_profile_invalid');
  if (value.schema !== 'eve-atelier-worker-context-profile/v1'
      || !string(value.profileId)
      || !string(value.purpose)
      || !safeValue(value.purpose)
      || !strings(value.allowedSections, { allowed: contextSections })
      || !integer(value.maxEntriesPerSection, { min: 1, max: 1000 })
      || !isCanonicalInstant(value.createdAt)) return result('aads_worker_profile_invalid');
  return result();
}

export function validateWorkerContextProjection(value) {
  if (!exact(value, [
    'schema', 'projectionId', 'contextSnapshotId', 'contextDigest', 'projectId',
    'profileId', 'purpose', 'sections', 'limits', 'authority', 'createdAt',
  ])) return result('aads_worker_projection_invalid');
  if (value.schema !== 'eve-atelier-worker-context-projection/v1'
      || !string(value.projectionId)
      || !string(value.contextSnapshotId)
      || !/^[a-f0-9]{64}$/.test(value.contextDigest)
      || !string(value.projectId)
      || !string(value.profileId)
      || !string(value.purpose)
      || !object(value.sections)
      || !exact(value.limits, ['allowedSections', 'maxEntriesPerSection'])
      || !strings(value.limits.allowedSections, { allowed: contextSections })
      || !integer(value.limits.maxEntriesPerSection, { min: 1, max: 1000 })
      || !exact(value.authority, [
        'writeBack', 'canEvaluate', 'canPromote', 'canMerge', 'canRelease', 'canDeploy',
      ])
      || Object.values(value.authority).some(item => item !== false)
      || !isCanonicalInstant(value.createdAt)
      || !safeValue(value)) return result('aads_worker_projection_invalid');
  const sectionNames = Object.keys(value.sections);
  if (sectionNames.length !== value.limits.allowedSections.length
      || sectionNames.some(name => !value.limits.allowedSections.includes(name))) {
    return result('aads_worker_projection_section_mismatch');
  }
  for (const items of Object.values(value.sections)) {
    if (!isDenseJsonArray(items) || items.length > value.limits.maxEntriesPerSection) {
      return result('aads_worker_projection_section_invalid');
    }
  }
  return result();
}

export function validateSessionEvent(value) {
  if (!exact(value, [
    'schema', 'eventId', 'sessionId', 'sequence', 'previousEventDigest',
    'eventDigest', 'type', 'nodeId', 'decision', 'output', 'usageDelta',
    'evidenceRefs', 'actor', 'occurredAt',
  ])) return result('aads_session_event_invalid');
  if (value.schema !== 'eve-atelier-aads-session-event/v1'
      || !string(value.eventId)
      || !string(value.sessionId)
      || !integer(value.sequence, { min: 1 })
      || (value.previousEventDigest !== null
        && !/^[a-f0-9]{64}$/.test(value.previousEventDigest))
      || !/^[a-f0-9]{64}$/.test(value.eventDigest)
      || !sessionEventTypes.includes(value.type)
      || (value.nodeId !== null && !string(value.nodeId))
      || (value.decision !== null && !AADS_DECISIONS.includes(value.decision))
      || !object(value.output)
      || !safeValue(value.output)
      || containsKey(value.output, sessionImplementationKey)
      || !exact(value.usageDelta, [
        'iterations', 'providerCalls', 'candidates', 'repairLoops',
        'costUnits', 'latencyMs',
      ])
      || !integer(value.usageDelta.iterations)
      || !integer(value.usageDelta.providerCalls)
      || !integer(value.usageDelta.candidates)
      || !integer(value.usageDelta.repairLoops)
      || !finite(value.usageDelta.costUnits)
      || !integer(value.usageDelta.latencyMs)
      || !strings(value.evidenceRefs, { empty: true })
      || !actor(value.actor)
      || !isCanonicalInstant(value.occurredAt)) return result('aads_session_event_invalid');
  return result();
}

export function sessionEventDigest(value) {
  const copy = cloneVisualValue(value);
  delete copy.eventDigest;
  return createDigest(copy);
}

export function createDigest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
