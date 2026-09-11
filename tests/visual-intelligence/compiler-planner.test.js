import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisualIntent } from '../../src/visual-intelligence/constraint-compiler.js';
import { buildVisualPlanAndWorkflow } from '../../src/visual-intelligence/planner.js';
import {
  validateRabclWorkflow,
  validateWorkerContextProjection,
} from '../../src/visual-intelligence/contracts.js';
import {
  backgroundIntent,
  closeVisualIntelligence,
  providerPolicy,
  sessionAuthority,
  sessionBudget,
  setupVisualIntelligence,
  startBackgroundSession,
} from './helpers.js';

test('builds an exact provider-neutral background-removal plan and bounded RABCL graph', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context);
    assert.deepEqual(started.plan.steps.map(step => step.operatorRef.operatorId), [
      'visual.op.raster.create_mask',
      'visual.op.raster.create_alpha',
      'visual.op.raster.edge_cleanup',
    ]);
    assert.deepEqual(started.workflow.nodes.map(node => node.kind), [
      'OPERATOR', 'OPERATOR', 'OPERATOR', 'EVALUATE', 'HUMAN_GATE',
      'PROMOTE', 'STOP', 'STOP', 'STOP', 'STOP',
    ]);
    assert.equal(started.workflow.nodes.find(node => node.nodeId === 'edge-cleanup').maxVisits, 2);
    assert.equal(JSON.stringify(started.plan).includes('sharp'), false);
    assert.equal(JSON.stringify(started.workflow).includes('ComfyUI'), false);
    assert.equal(started.snapshot.currentNodeId, 'create-mask');
    const wrongKind = structuredClone(started.workflow);
    wrongKind.nodes.find(node => node.nodeId === 'human-review').candidateBinding.nodeId = 'evaluate';
    assert.equal(validateRabclWorkflow(wrongKind).reason,
      'rabcl_workflow_binding_producer_invalid');
    const futureBinding = structuredClone(started.workflow);
    futureBinding.nodes.find(node => node.nodeId === 'create-alpha').params.mask = {
      $ref: 'NODE_OUTPUT',
      nodeId: 'edge-cleanup',
      path: 'asset.assetId',
    };
    assert.equal(validateRabclWorkflow(futureBinding).reason,
      'rabcl_workflow_binding_not_dominating');
    const forgedBinding = structuredClone(started.workflow);
    forgedBinding.nodes.find(node => node.nodeId === 'create-alpha').params.mask.extra = true;
    assert.equal(validateRabclWorkflow(forgedBinding).reason, 'rabcl_workflow_node_invalid');
  } finally {
    closeVisualIntelligence(context);
  }
});

test('unknown intent produces only a terminal needs-human workflow and zero provider work', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = context.controller.startSession({
      intent: backgroundIntent({
        intentId: 'intent:v03:unknown',
        text: '讓它更有那個感覺。',
      }),
      sessionId: 'session:v03:unknown',
      packetId: 'packet:v03:unknown',
      planId: 'plan:v03:unknown',
      workflowId: 'workflow:v03:unknown',
      contextSnapshotId: 'context:v03:unknown',
      contextVersion: 1,
      packRef: context.packRef,
      providerPolicy: providerPolicy(context.capability),
      budget: sessionBudget(),
      authority: sessionAuthority(),
    });
    assert.equal(started.packet.requiresHumanClarification, true);
    assert.deepEqual(started.plan.steps, []);
    const ended = await context.controller.run(started.session.sessionId);
    assert.equal(ended.status, 'STOPPED');
    assert.equal(ended.terminalOutcome, 'NEEDS_HUMAN');
    assert.equal(ended.usage.providerCalls, 0);
    assert.equal(context.documentStore.getDocumentSnapshot(started.session.documentId)
      .currentVersion.versionId, 'version:v03:source');
  } finally {
    closeVisualIntelligence(context);
  }
});

test('does not fake an executable relight plan when the active pack lacks physical operators', async () => {
  const context = await setupVisualIntelligence();
  try {
    const packet = compileVisualIntent(backgroundIntent({
      intentId: 'intent:v03:relight',
      text: '左後冷光，臉留暖光，不要把人改掉。',
    }), {
      packetId: 'packet:v03:relight',
      compiledAt: '2026-09-11T04:10:00Z',
    });
    assert.throws(() => buildVisualPlanAndWorkflow({
      packet,
      packRef: context.packRef,
      operatorStore: context.operatorStore,
      planId: 'plan:v03:relight',
      workflowId: 'workflow:v03:relight',
      providerPolicy: providerPolicy(context.capability),
      createdAt: '2026-09-11T04:10:01Z',
    }), /aads_plan_task_not_executable:RELIGHT/);
  } finally {
    closeVisualIntelligence(context);
  }
});

test('store rejects omitted planned operators, undeclared fallbacks, and widened privacy', async () => {
  const context = await setupVisualIntelligence();
  try {
    const intent = context.visualStore.registerIntent(backgroundIntent({
      intentId: 'intent:v03:workflow-closure',
    }));
    const packet = compileVisualIntent(intent, {
      packetId: 'packet:v03:workflow-closure',
      compiledAt: '2026-09-11T04:20:00Z',
    });
    context.visualStore.registerConstraintPacket(packet);
    const built = buildVisualPlanAndWorkflow({
      packet,
      packRef: context.packRef,
      operatorStore: context.operatorStore,
      planId: 'plan:v03:workflow-closure',
      workflowId: 'workflow:v03:workflow-closure',
      providerPolicy: providerPolicy(context.capability),
      createdAt: '2026-09-11T04:20:01Z',
    });
    context.visualStore.registerOperatorPlan(built.plan);

    const omitted = structuredClone(built.workflow);
    omitted.nodes.find(node => node.nodeId === 'edge-cleanup').operatorRef = {
      operatorId: 'visual.op.raster.create_alpha', version: '1.0.0',
    };
    assert.throws(() => context.visualStore.registerWorkflow(omitted),
      /rabcl_workflow_planned_step_missing:step:edge-cleanup/);

    const fallback = structuredClone(built.workflow);
    fallback.nodes.find(node => node.nodeId === 'create-mask').fallback.push({
      decision: 'REBIND', nodeId: 'create-mask',
    });
    assert.throws(() => context.visualStore.registerWorkflow(fallback),
      /rabcl_workflow_operator_fallback_forbidden:create-mask/);

    const widened = structuredClone(built.workflow);
    widened.nodes.find(node => node.nodeId === 'create-mask')
      .providerPolicy.allowedPrivacy.push('REMOTE_PUBLIC');
    assert.throws(() => context.visualStore.registerWorkflow(widened),
      /rabcl_workflow_provider_policy_widened:create-mask/);
  } finally {
    closeVisualIntelligence(context);
  }
});

test('binds reference directions to verified CAS assets without role substitution', async () => {
  const context = await setupVisualIntelligence();
  try {
    const asset = context.documentStore.getDocumentSnapshot('document:synthetic:v02')
      .currentVersion.primaryAsset;
    const intent = backgroundIntent({
      intentId: 'intent:v03:reference-binding',
      references: [{
        referenceId: 'reference:v03:identity',
        assetRef: asset,
        role: 'IDENTITY',
        appliesTo: ['IDENTITY', 'STRUCTURE'],
      }],
    });
    context.visualStore.registerIntent(intent);
    const packet = compileVisualIntent(intent, {
      packetId: 'packet:v03:reference-binding',
      compiledAt: '2026-09-11T04:25:00Z',
    });
    assert.equal(context.visualStore.registerConstraintPacket(packet)
      .referenceDirections[0].assetRef.sha256, asset.sha256);
    const forgedIntent = backgroundIntent({
      intentId: 'intent:v03:missing-reference',
      references: [{
        referenceId: 'reference:v03:missing',
        assetRef: {
          assetId: `asset:sha256:${'f'.repeat(64)}`,
          sha256: 'f'.repeat(64),
          mediaType: 'image/png',
          byteSize: 1,
        },
        role: 'IDENTITY',
        appliesTo: ['IDENTITY'],
      }],
    });
    assert.throws(() => context.visualStore.registerIntent(forgedIntent), /asset_not_found/);
  } finally {
    closeVisualIntelligence(context);
  }
});

test('projects a digest-bound read-only context home with an allowlisted surface', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context);
    const projection = context.controller.projectContext({
      contextSnapshotId: started.context.contextSnapshotId,
      projectionId: 'projection:v03:worker-context',
      profile: {
        schema: 'eve-atelier-worker-context-profile/v1',
        profileId: 'worker-profile:v03:implementation',
        purpose: 'Interpret EveAtelier operator and document identities before drafting.',
        allowedSections: ['GLOSSARY', 'OPERATORS', 'DOCUMENTS', 'AUTHORITIES'],
        maxEntriesPerSection: 10,
        createdAt: '2026-09-11T03:59:00Z',
      },
    });
    assert.match(projection.contextDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(new Set(Object.keys(projection.sections)), new Set([
      'GLOSSARY', 'OPERATORS', 'DOCUMENTS', 'AUTHORITIES',
    ]));
    assert.equal(projection.authority.writeBack, false);
    assert.equal(projection.authority.canPromote, false);
    assert.equal(projection.authority.canDeploy, false);
    assert.equal(validateWorkerContextProjection(projection).ok, true);
    assert.deepEqual(context.visualStore.getWorkerProjection(projection.projectionId), projection);
    assert.equal(context.visualStore.getWorkerProfile(projection.profileId).profileId,
      projection.profileId);
    assert.equal(context.visualStore.getLatestContextSnapshot(started.context.projectId)
      .contextSnapshotId, started.context.contextSnapshotId);
    assert.equal(context.visualStore.listWorkerProjections({
      contextSnapshotId: started.context.contextSnapshotId,
      profileId: projection.profileId,
    }).length, 1);
    const forged = structuredClone(projection);
    forged.authority.writeBack = true;
    assert.equal(validateWorkerContextProjection(forged).ok, false);
    const contentForgery = structuredClone(projection);
    contentForgery.projectionId = 'projection:v03:worker-context-forged';
    contentForgery.sections.GLOSSARY[0].meaning = 'Forged replacement meaning.';
    assert.throws(() => context.visualStore.recordWorkerProjection(contentForgery),
      /aads_worker_projection_content_mismatch/);
    assert.equal(/[A-Za-z]:[\\/]/.test(JSON.stringify(projection)), false);
    assert.throws(() => context.visualStore.registerContextSnapshot({
      ...structuredClone(started.context),
      contextSnapshotId: 'context:v03:out-of-sequence',
      contextVersion: 3,
    }), /aads_context_version_out_of_sequence:2/);
    assert.throws(() => context.controller.projectContext({
      contextSnapshotId: started.context.contextSnapshotId,
      projectionId: 'projection:v03:forbidden',
      profile: {
        schema: 'eve-atelier-worker-context-profile/v1',
        profileId: 'worker-profile:v03:forbidden',
        purpose: 'Ask for an unapproved section.',
        allowedSections: ['PRIVATE_CHAT'],
        maxEntriesPerSection: 10,
        createdAt: '2026-09-11T03:59:01Z',
      },
    }), /aads_worker_profile_invalid/);
  } finally {
    closeVisualIntelligence(context);
  }
});

test('session bundle creation is atomic when a late context precondition fails', async () => {
  const context = await setupVisualIntelligence();
  try {
    assert.throws(() => context.controller.startSession({
      intent: backgroundIntent({ intentId: 'intent:v03:atomic-rollback' }),
      sessionId: 'session:v03:atomic-rollback',
      packetId: 'packet:v03:atomic-rollback',
      planId: 'plan:v03:atomic-rollback',
      workflowId: 'workflow:v03:atomic-rollback',
      contextSnapshotId: 'context:v03:atomic-rollback',
      contextVersion: 3,
      packRef: context.packRef,
      providerPolicy: providerPolicy(context.capability),
      budget: sessionBudget(),
      authority: sessionAuthority(),
    }), /aads_context_version_out_of_sequence:1/);
    assert.throws(() => context.visualStore.getIntent('intent:v03:atomic-rollback'),
      /aads_intent_not_found/);
    assert.throws(() => context.visualStore.getConstraintPacket('packet:v03:atomic-rollback'),
      /aads_constraint_packet_not_found/);
    assert.throws(() => context.visualStore.getOperatorPlan('plan:v03:atomic-rollback'),
      /aads_operator_plan_not_found/);
  } finally {
    closeVisualIntelligence(context);
  }
});
