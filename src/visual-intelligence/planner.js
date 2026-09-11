import {
  AADS_DECISIONS,
  cloneVisualValue,
  normalizeVisualValue,
  validateConstraintPacket,
  validateOperatorPlan,
  validateRabclWorkflow,
} from './contracts.js';

function exactOperator(pack, operatorId) {
  const matches = pack.families.flatMap(family => family.variants)
    .filter(item => item.operatorId === operatorId);
  if (matches.length !== 1) throw new Error(`aads_planner_operator_ambiguous:${operatorId}`);
  const operator = matches[0];
  if (operator.executionMode !== 'PROVIDER_BOUND' || operator.authority !== 'CANDIDATE_ONLY') {
    throw new Error(`aads_planner_operator_not_executable:${operatorId}`);
  }
  return { operatorId: operator.operatorId, version: operator.version };
}

function stop(nodeId, outcome) {
  return { nodeId, kind: 'STOP', maxVisits: 1, outcome };
}

function validateProviderPolicy(value) {
  if (!value
      || typeof value !== 'object'
      || Array.isArray(value)
      || Object.keys(value).length !== 5
      || !Array.isArray(value.allowedPrivacy)
      || !Array.isArray(value.requiredSupports)
      || !Array.isArray(value.allowedLicenseSpdx)
      || !Array.isArray(value.allowedLicenseBoundaries)
      || typeof value.verifiedAtOrAfter !== 'string') {
    throw new TypeError('aads_planner_provider_policy_invalid');
  }
  return cloneVisualValue(value);
}

export function buildVisualPlanAndWorkflow({
  packet: rawPacket,
  packRef,
  operatorStore,
  planId,
  workflowId,
  providerPolicy,
  createdAt,
} = {}) {
  const packet = normalizeVisualValue(rawPacket, 'aads_constraint_packet_json_value_invalid');
  const packetValidation = validateConstraintPacket(packet);
  if (!packetValidation.ok) throw new Error(packetValidation.reason);
  if (!operatorStore
      || typeof operatorStore.getPack !== 'function'
      || typeof operatorStore.getStatus !== 'function') {
    throw new TypeError('aads_planner_operator_store_required');
  }
  if (operatorStore.getStatus(packRef) !== 'ACTIVE') throw new Error('aads_planner_pack_not_active');
  const pack = operatorStore.getPack(packRef);
  if (packet.taskType === 'UNKNOWN') {
    const plan = {
      schema: 'eve-atelier-operator-plan/v1',
      planId,
      packetId: packet.packetId,
      packRef: cloneVisualValue(packRef),
      taskType: 'UNKNOWN',
      steps: [],
      decisionPolicy: ['ASK_HUMAN', 'STOP'],
      createdAt,
    };
    const workflow = {
      schema: 'eve-atelier-rabcl-workflow/v1',
      workflowId,
      version: '1.0.0',
      planId,
      packetId: packet.packetId,
      entryNodeId: 'stop-needs-human',
      nodes: [stop('stop-needs-human', 'NEEDS_HUMAN')],
      createdAt,
    };
    const planValidation = validateOperatorPlan(plan);
    const workflowValidation = validateRabclWorkflow(workflow);
    if (!planValidation.ok) throw new Error(planValidation.reason);
    if (!workflowValidation.ok) throw new Error(workflowValidation.reason);
    return { plan, workflow };
  }
  if (packet.taskType !== 'BACKGROUND_REMOVAL') {
    throw new Error(`aads_plan_task_not_executable:${packet.taskType}`);
  }
  const policy = validateProviderPolicy(providerPolicy);
  const mask = exactOperator(pack, 'visual.op.raster.create_mask');
  const alpha = exactOperator(pack, 'visual.op.raster.create_alpha');
  const cleanup = exactOperator(pack, 'visual.op.raster.edge_cleanup');
  const plan = {
    schema: 'eve-atelier-operator-plan/v1',
    planId,
    packetId: packet.packetId,
    packRef: cloneVisualValue(packRef),
    taskType: packet.taskType,
    steps: [{
      stepId: 'step:create-mask',
      operatorRef: mask,
      purpose: 'Derive a foreground pixel mask without mutating the source.',
      targetRole: 'INITIAL_DOCUMENT_VERSION',
      outputRole: 'FOREGROUND_MASK',
    }, {
      stepId: 'step:create-alpha',
      operatorRef: alpha,
      purpose: 'Apply the verified mask as explicit alpha on a candidate.',
      targetRole: 'INITIAL_DOCUMENT_VERSION',
      outputRole: 'ALPHA_CANDIDATE',
    }, {
      stepId: 'step:edge-cleanup',
      operatorRef: cleanup,
      purpose: 'Repair only mask-selected alpha edges.',
      targetRole: 'LATEST_CANDIDATE',
      outputRole: 'CLEAN_CANDIDATE',
    }],
    decisionPolicy: [...AADS_DECISIONS],
    createdAt,
  };
  const human = packet.evaluationPolicy.humanReview;
  const workflow = {
    schema: 'eve-atelier-rabcl-workflow/v1',
    workflowId,
    version: '1.0.0',
    planId,
    packetId: packet.packetId,
    entryNodeId: 'create-mask',
    nodes: [{
      nodeId: 'create-mask',
      kind: 'OPERATOR',
      maxVisits: 1,
      operatorRef: mask,
      targetBinding: { kind: 'INITIAL', nodeId: null },
      params: { background: [255, 255, 255], tolerance: 8 },
      providerPolicy: policy,
      output: { mediaType: 'image/png', extension: 'png' },
      commit: { kind: 'ASSET_ONLY', outputRole: 'FOREGROUND_MASK' },
      onSuccess: 'create-alpha',
      onFailure: 'stop-failed',
      fallback: [
        { decision: 'RECOMPILE', nodeId: 'stop-needs-human' },
        { decision: 'ASK_HUMAN', nodeId: 'stop-needs-human' },
      ],
    }, {
      nodeId: 'create-alpha',
      kind: 'OPERATOR',
      maxVisits: 2,
      operatorRef: alpha,
      targetBinding: { kind: 'INITIAL', nodeId: null },
      params: {
        mask: { $ref: 'NODE_OUTPUT', nodeId: 'create-mask', path: 'asset.assetId' },
      },
      providerPolicy: policy,
      output: { mediaType: 'image/png', extension: 'png' },
      commit: { kind: 'CANDIDATE_VERSION', outputRole: 'ALPHA_CANDIDATE' },
      onSuccess: 'edge-cleanup',
      onFailure: 'stop-failed',
      fallback: [
        { decision: 'REPAIR', nodeId: 'create-alpha' },
        { decision: 'ASK_HUMAN', nodeId: 'stop-needs-human' },
      ],
    }, {
      nodeId: 'edge-cleanup',
      kind: 'OPERATOR',
      maxVisits: 2,
      operatorRef: cleanup,
      targetBinding: { kind: 'LATEST_CANDIDATE', nodeId: 'create-alpha' },
      params: {
        radius: 1,
        mask: { $ref: 'NODE_OUTPUT', nodeId: 'create-mask', path: 'asset.assetId' },
      },
      providerPolicy: policy,
      output: { mediaType: 'image/png', extension: 'png' },
      commit: { kind: 'CANDIDATE_VERSION', outputRole: 'CLEAN_CANDIDATE' },
      onSuccess: 'evaluate',
      onFailure: 'stop-failed',
      fallback: [
        { decision: 'REPAIR', nodeId: 'edge-cleanup' },
        { decision: 'ASK_HUMAN', nodeId: 'stop-needs-human' },
      ],
    }, {
      nodeId: 'evaluate',
      kind: 'EVALUATE',
      maxVisits: 2,
      inputBinding: { kind: 'NODE_OUTPUT', nodeId: 'edge-cleanup' },
      evaluatorRef: {
        kind: 'DETERMINISTIC',
        id: 'validator:background-removal',
        version: '1.0.0',
      },
      onAccept: human ? 'human-review' : 'promote',
      onRepair: 'edge-cleanup',
      onReject: 'stop-rejected',
    }, ...(human ? [{
      nodeId: 'human-review',
      kind: 'HUMAN_GATE',
      maxVisits: 1,
      candidateBinding: { kind: 'NODE_OUTPUT', nodeId: 'edge-cleanup' },
      evaluationBinding: { kind: 'NODE_OUTPUT', nodeId: 'evaluate' },
      prompt: 'Review the evaluated background-removal candidate before promotion.',
      onApprove: 'promote',
      onReject: 'stop-rejected',
    }] : []), {
      nodeId: 'promote',
      kind: 'PROMOTE',
      maxVisits: 1,
      candidateBinding: { kind: 'NODE_OUTPUT', nodeId: 'edge-cleanup' },
      evaluationBinding: { kind: 'NODE_OUTPUT', nodeId: 'evaluate' },
      reviewBinding: human
        ? { kind: 'NODE_OUTPUT', nodeId: 'human-review' }
        : null,
      onSuccess: 'stop-accepted',
      onFailure: 'stop-failed',
    },
    stop('stop-accepted', 'ACCEPTED'),
    stop('stop-rejected', 'REJECTED'),
    stop('stop-needs-human', 'NEEDS_HUMAN'),
    stop('stop-failed', 'FAILED')],
    createdAt,
  };
  const planValidation = validateOperatorPlan(plan);
  const workflowValidation = validateRabclWorkflow(workflow);
  if (!planValidation.ok) throw new Error(planValidation.reason);
  if (!workflowValidation.ok) throw new Error(workflowValidation.reason);
  return { plan, workflow };
}
