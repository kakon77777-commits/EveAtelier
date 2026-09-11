import test from 'node:test';
import assert from 'node:assert/strict';
import { RabclRuntime } from '../../src/visual-intelligence/rabcl-runtime.js';
import {
  advancingClock,
  closeVisualIntelligence,
  human,
  sessionAuthority,
  sessionBudget,
  setupVisualIntelligence,
  startBackgroundSession,
} from './helpers.js';

test('stops before dispatch when provider-call or candidate budget is exhausted', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context, {
      sessionId: 'session:v03:zero-budget',
      packetId: 'packet:v03:zero-budget',
      planId: 'plan:v03:zero-budget',
      workflowId: 'workflow:v03:zero-budget',
      contextSnapshotId: 'context:v03:zero-budget',
      intent: { intentId: 'intent:v03:zero-budget' },
      budget: sessionBudget({ maxProviderCalls: 0, maxCandidates: 0 }),
    });
    const stopped = await context.controller.run(started.session.sessionId);
    assert.equal(stopped.status, 'STOPPED');
    assert.equal(stopped.terminalOutcome, 'BUDGET_EXHAUSTED');
    assert.equal(stopped.usage.providerCalls, 0);
    assert.equal(stopped.usage.candidates, 0);
    assert.equal(stopped.visits['create-mask'], undefined);
    assert.equal(context.documentStore.getDocumentSnapshot(started.session.documentId)
      .currentVersion.versionId, 'version:v03:source');
  } finally {
    closeVisualIntelligence(context);
  }
});

test('rejects stale initial ArtDocument authority before any provider dispatch', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context, {
      sessionId: 'session:v03:stale-art',
      packetId: 'packet:v03:stale-art',
      planId: 'plan:v03:stale-art',
      workflowId: 'workflow:v03:stale-art',
      contextSnapshotId: 'context:v03:stale-art',
      intent: { intentId: 'intent:v03:stale-art' },
    });
    let calls = 0;
    const adapter = {
      getArtSnapshot: id => {
        const art = context.documentStore.getDocumentSnapshot(id);
        return { ...art, documentRevision: art.documentRevision + 1 };
      },
      async executeOperator() { calls += 1; return null; },
      evaluate() { throw new Error('not_expected'); },
      recordHumanReview() { throw new Error('not_expected'); },
      promote() { throw new Error('not_expected'); },
    };
    const runtime = new RabclRuntime({
      store: context.visualStore,
      adapter,
      now: advancingClock('2026-09-11T05:05:00Z'),
    });
    const stopped = await runtime.run(started.session.sessionId);
    assert.equal(stopped.status, 'STOPPED');
    assert.equal(stopped.terminalOutcome, 'FAILED');
    assert.equal(calls, 0);
    assert.equal(stopped.usage.providerCalls, 0);
    assert.equal(stopped.visits['create-mask'], undefined);
  } finally {
    closeVisualIntelligence(context);
  }
});

test('never follows an undeclared fallback edge even when an adapter recommends it', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context, {
      sessionId: 'session:v03:undeclared-fallback',
      packetId: 'packet:v03:undeclared-fallback',
      planId: 'plan:v03:undeclared-fallback',
      workflowId: 'workflow:v03:undeclared-fallback',
      contextSnapshotId: 'context:v03:undeclared-fallback',
      intent: { intentId: 'intent:v03:undeclared-fallback' },
    });
    let calls = 0;
    const adapter = {
      getArtSnapshot: id => context.documentStore.getDocumentSnapshot(id),
      async executeOperator() {
        calls += 1;
        return {
          status: 'FAILED',
          failureClass: 'PROVIDER_UNAVAILABLE',
          decision: 'REBIND',
          retryAuthorized: true,
          evidenceRefs: ['evidence:v03:synthetic-rebind'],
          usage: { providerCalls: 1, candidates: 0, costUnits: 0, latencyMs: 0 },
        };
      },
      evaluate() { throw new Error('not_expected'); },
      recordHumanReview() { throw new Error('not_expected'); },
      promote() { throw new Error('not_expected'); },
    };
    const runtime = new RabclRuntime({
      store: context.visualStore,
      adapter,
      now: advancingClock('2026-09-11T05:10:00Z'),
    });
    const stopped = await runtime.run(started.session.sessionId);
    assert.equal(calls, 1);
    assert.equal(stopped.status, 'STOPPED');
    assert.equal(stopped.terminalOutcome, 'FAILED');
    assert.equal(stopped.decisions.some(item => item.decision === 'REBIND'), false);
    assert.equal(stopped.outputs['create-mask'].nextNodeId, 'stop-failed');
  } finally {
    closeVisualIntelligence(context);
  }
});

test('classifies an adapter throw after NODE_STARTED as non-retryable unknown dispatch', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context, {
      sessionId: 'session:v03:adapter-throw',
      packetId: 'packet:v03:adapter-throw',
      planId: 'plan:v03:adapter-throw',
      workflowId: 'workflow:v03:adapter-throw',
      contextSnapshotId: 'context:v03:adapter-throw',
      intent: { intentId: 'intent:v03:adapter-throw' },
    });
    let calls = 0;
    const adapter = {
      getArtSnapshot: id => context.documentStore.getDocumentSnapshot(id),
      async executeOperator() {
        calls += 1;
        const error = new Error('uncertain');
        error.code = 'UNKNOWN_AFTER_DISPATCH';
        throw error;
      },
      evaluate() { throw new Error('not_expected'); },
      recordHumanReview() { throw new Error('not_expected'); },
      promote() { throw new Error('not_expected'); },
    };
    const runtime = new RabclRuntime({
      store: context.visualStore,
      adapter,
      now: advancingClock('2026-09-11T05:15:00Z'),
    });
    const stopped = await runtime.run(started.session.sessionId);
    assert.equal(calls, 1);
    assert.equal(stopped.status, 'STOPPED');
    assert.equal(stopped.terminalOutcome, 'FAILED');
    assert.equal(stopped.usage.providerCalls, 1);
    assert.equal(stopped.visits['create-mask'], 1);
    assert.equal(stopped.decisions.some(item => item.decision === 'REBIND'), false);
  } finally {
    closeVisualIntelligence(context);
  }
});

test('follows only a declared repair loop and stops at its durable bound', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context, {
      sessionId: 'session:v03:bounded-repair',
      packetId: 'packet:v03:bounded-repair',
      planId: 'plan:v03:bounded-repair',
      workflowId: 'workflow:v03:bounded-repair',
      contextSnapshotId: 'context:v03:bounded-repair',
      intent: { intentId: 'intent:v03:bounded-repair' },
      budget: sessionBudget({ maxRepairLoops: 1 }),
    });
    let calls = 0;
    const fakeAsset = {
      assetId: `asset:sha256:${'a'.repeat(64)}`,
      sha256: 'a'.repeat(64),
      mediaType: 'image/png',
      byteSize: 1,
    };
    const adapter = {
      getArtSnapshot: id => context.documentStore.getDocumentSnapshot(id),
      async executeOperator({ node }) {
        calls += 1;
        if (node.nodeId === 'create-mask') {
          return {
            status: 'COMPLETED',
            asset: fakeAsset,
            candidateVersionId: null,
            executionId: 'execution:v03:fake-mask',
            outputRole: 'FOREGROUND_MASK',
            evidenceRefs: ['evidence:v03:fake-mask'],
            usage: { providerCalls: 1, candidates: 0, costUnits: 0, latencyMs: 0 },
          };
        }
        return {
          status: 'FAILED',
          failureClass: 'QUALITY_FAILURE',
          decision: 'REPAIR',
          retryAuthorized: true,
          evidenceRefs: ['evidence:v03:repair-request'],
          usage: { providerCalls: 1, candidates: 0, costUnits: 0, latencyMs: 0 },
        };
      },
      evaluate() { throw new Error('not_expected'); },
      recordHumanReview() { throw new Error('not_expected'); },
      promote() { throw new Error('not_expected'); },
    };
    const runtime = new RabclRuntime({
      store: context.visualStore,
      adapter,
      now: advancingClock('2026-09-11T05:20:00Z'),
    });
    const stopped = await runtime.run(started.session.sessionId);
    assert.equal(calls, 3);
    assert.equal(stopped.status, 'STOPPED');
    assert.equal(stopped.terminalOutcome, 'BUDGET_EXHAUSTED');
    assert.equal(stopped.visits['create-alpha'], 2);
    assert.equal(stopped.usage.repairLoops, 1);
    assert.equal(stopped.decisions.filter(item => item.decision === 'REPAIR').length, 1);
  } finally {
    closeVisualIntelligence(context);
  }
});

test('human gate rejects AI input and promotion-forbidden authority remains non-current', async () => {
  const context = await setupVisualIntelligence();
  try {
    const authority = sessionAuthority({
      allowedActions: ['PLAN', 'EXECUTE', 'EVALUATE', 'REQUEST_HUMAN', 'STOP'],
      promotionMode: 'FORBIDDEN',
    });
    const started = startBackgroundSession(context, {
      sessionId: 'session:v03:no-promotion',
      packetId: 'packet:v03:no-promotion',
      planId: 'plan:v03:no-promotion',
      workflowId: 'workflow:v03:no-promotion',
      contextSnapshotId: 'context:v03:no-promotion',
      intent: { intentId: 'intent:v03:no-promotion' },
      authority,
    });
    const waiting = await context.controller.run(started.session.sessionId);
    assert.equal(waiting.status, 'WAITING_HUMAN');
    assert.equal(waiting.currentNodeId, 'human-review');
    assert.throws(() => context.controller.submitHumanDecision({
      sessionId: started.session.sessionId,
      decision: 'APPROVE',
      reason: 'AI cannot fill this gate.',
      reviewer: { kind: 'AI', id: 'ai:not-human' },
    }), /art_human_review_invalid/);
    assert.equal(context.visualStore.getSessionSnapshot(started.session.sessionId).status,
      'WAITING_HUMAN');
    context.controller.submitHumanDecision({
      sessionId: started.session.sessionId,
      decision: 'APPROVE',
      reason: 'Human approval is recorded but promotion authority remains forbidden.',
      reviewer: human,
    });
    const stopped = await context.controller.run(started.session.sessionId);
    assert.equal(stopped.status, 'STOPPED');
    assert.equal(stopped.terminalOutcome, 'FAILED');
    assert.equal(stopped.visits.promote, undefined);
    assert.equal(context.documentStore.getDocumentSnapshot(started.session.documentId)
      .currentVersion.versionId, 'version:v03:source');
  } finally {
    closeVisualIntelligence(context);
  }
});

test('rechecks ArtDocument current authority after a human wait and before promotion', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context, {
      sessionId: 'session:v03:stale-before-promotion',
      packetId: 'packet:v03:stale-before-promotion',
      planId: 'plan:v03:stale-before-promotion',
      workflowId: 'workflow:v03:stale-before-promotion',
      contextSnapshotId: 'context:v03:stale-before-promotion',
      intent: { intentId: 'intent:v03:stale-before-promotion' },
    });
    const waiting = await context.controller.run(started.session.sessionId);
    assert.equal(waiting.status, 'WAITING_HUMAN');
    context.controller.submitHumanDecision({
      sessionId: started.session.sessionId,
      decision: 'APPROVE',
      reason: 'Approval is valid, but current authority will be rechecked.',
      reviewer: human,
    });
    let promotions = 0;
    const staleAdapter = {
      getArtSnapshot: id => {
        const art = context.documentStore.getDocumentSnapshot(id);
        return { ...art, documentRevision: art.documentRevision + 1 };
      },
      async executeOperator() { throw new Error('not_expected'); },
      evaluate() { throw new Error('not_expected'); },
      recordHumanReview() { throw new Error('not_expected'); },
      promote() { promotions += 1; },
    };
    const runtime = new RabclRuntime({
      store: context.visualStore,
      adapter: staleAdapter,
      now: advancingClock('2026-09-11T07:00:00Z'),
    });
    const stopped = await runtime.run(started.session.sessionId);
    assert.equal(stopped.status, 'STOPPED');
    assert.equal(stopped.terminalOutcome, 'FAILED');
    assert.equal(promotions, 0);
    assert.equal(stopped.visits.promote, undefined);
    assert.equal(context.documentStore.getDocumentSnapshot(started.session.documentId)
      .currentVersion.versionId, 'version:v03:source');
  } finally {
    closeVisualIntelligence(context);
  }
});
