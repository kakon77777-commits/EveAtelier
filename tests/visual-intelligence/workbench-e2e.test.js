import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AssetStore } from '../../src/art-domain/asset-store.js';
import { ArtDocumentStore } from '../../src/art-domain/store.js';
import { ArtTargetResolver } from '../../src/art-domain/target-resolver.js';
import { WorkbenchExecutionBridge } from '../../src/art-domain/workbench-runtime.js';
import { OperatorRegistryStore } from '../../src/operator-runtime/registry-store.js';
import { SharpRasterProvider } from '../../src/providers/sharp-raster-provider.js';
import { evaluateBackgroundRemovalCandidate } from '../../src/visual-intelligence/evaluators.js';
import { VisualIntelligenceStore } from '../../src/visual-intelligence/session-store.js';
import { WorkbenchRabclAdapter } from '../../src/visual-intelligence/workbench-adapter.js';
import { AadsController } from '../../src/visual-intelligence/controller.js';
import {
  advancingClock,
  closeVisualIntelligence,
  human,
  setupVisualIntelligence,
  startBackgroundSession,
} from './helpers.js';

test('completes deterministic policy without inventing a human review', async () => {
  const context = await setupVisualIntelligence({ promotionPolicy: 'automatic_deterministic' });
  try {
    const started = startBackgroundSession(context, {
      sessionId: 'session:v03:automatic',
      packetId: 'packet:v03:automatic',
      planId: 'plan:v03:automatic',
      workflowId: 'workflow:v03:automatic',
      contextSnapshotId: 'context:v03:automatic',
      intent: { intentId: 'intent:v03:automatic' },
    });
    assert.equal(started.workflow.nodes.some(node => node.kind === 'HUMAN_GATE'), false);
    const completed = await context.controller.run(started.session.sessionId);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.terminalOutcome, 'ACCEPTED');
    assert.equal(completed.outputs.promote.reviewId, null);
    assert.equal(context.documentStore.getDocumentSnapshot(started.session.documentId)
      .currentVersion.versionId, completed.outputs.promote.currentVersionId);
  } finally {
    closeVisualIntelligence(context);
  }
});

test('runs natural-language intent through RABCL and resumes human-approved promotion', async () => {
  const context = await setupVisualIntelligence({ promotionPolicy: 'human_required' });
  let initialClosed = false;
  try {
    const started = startBackgroundSession(context);
    const waiting = await context.controller.run(started.session.sessionId);
    assert.equal(waiting.status, 'WAITING_HUMAN');
    assert.equal(waiting.currentNodeId, 'human-review');
    assert.deepEqual(waiting.usage, {
      iterations: 5,
      providerCalls: 3,
      candidates: 2,
      repairLoops: 0,
      costUnits: 0,
      latencyMs: 3000,
    });
    assert.equal(waiting.outputs['create-mask'].candidateVersionId, null);
    assert.match(waiting.outputs['create-mask'].asset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(waiting.outputs['create-alpha'].candidateVersionId,
      'version:session:v03:background-removal:create-alpha:1');
    assert.equal(waiting.outputs['edge-cleanup'].candidateVersionId,
      'version:session:v03:background-removal:edge-cleanup:1');
    assert.equal(waiting.outputs.evaluate.verdict, 'ACCEPT');
    assert.equal(context.documentStore.getDocumentSnapshot(started.session.documentId)
      .currentVersion.versionId, 'version:v03:source');

    const expectedCandidate = waiting.outputs['edge-cleanup'];
    const lastDigest = waiting.lastEventDigest;
    context.visualStore.close();
    context.operatorStore.close();
    context.documentStore.close();
    context.assetStore.close();
    initialClosed = true;

    const assetStore = new AssetStore({ root: join(context.root, 'assets') });
    const documentStore = new ArtDocumentStore({
      path: join(context.root, 'art.sqlite3'),
      assetStore,
    });
    const operatorStore = new OperatorRegistryStore({
      path: join(context.root, 'operators.sqlite3'),
    });
    const provider = new SharpRasterProvider({ now: () => '2026-09-11T06:00:00Z' });
    const capability = await provider.capability();
    const resolver = new ArtTargetResolver({ store: documentStore, assetStore });
    const bridge = new WorkbenchExecutionBridge({
      assetStore,
      documentStore,
      operatorStore,
      targetResolver: resolver,
      providers: [provider],
      manifests: [capability],
      stagingRoot: join(context.root, 'staging'),
    });
    const visualStore = new VisualIntelligenceStore({
      path: join(context.root, 'visual-intelligence.sqlite3'),
      artDocumentStore: documentStore,
      operatorStore,
      assetStore,
    });
    const adapter = new WorkbenchRabclAdapter({
      bridge,
      documentStore,
      assetStore,
      evaluators: { 'validator:background-removal': evaluateBackgroundRemovalCandidate },
    });
    const controller = new AadsController({
      store: visualStore,
      operatorStore,
      adapter,
      now: advancingClock('2026-09-11T06:00:00Z'),
    });
    try {
      const reopened = visualStore.getSessionSnapshot(started.session.sessionId);
      assert.equal(reopened.status, 'WAITING_HUMAN');
      assert.equal(reopened.lastEventDigest, lastDigest);
      assert.deepEqual(reopened.outputs['edge-cleanup'], expectedCandidate);
      controller.submitHumanDecision({
        sessionId: started.session.sessionId,
        decision: 'APPROVE',
        reason: 'Synthetic alpha and edge evidence is acceptable for this contract control.',
        reviewer: human,
      });
      const completed = await controller.run(started.session.sessionId);
      assert.equal(completed.status, 'COMPLETED');
      assert.equal(completed.terminalOutcome, 'ACCEPTED');
      assert.equal(completed.usage.providerCalls, 3);
      assert.equal(completed.usage.candidates, 2);
      assert.equal(completed.outputs['human-review'].disposition, 'APPROVE');
      assert.equal(completed.outputs.promote.currentVersionId,
        expectedCandidate.candidateVersionId);
      const art = documentStore.getDocumentSnapshot(started.session.documentId);
      assert.equal(art.currentVersion.versionId, expectedCandidate.candidateVersionId);
      assert.equal(art.currentVersion.primaryAsset.sha256, expectedCandidate.asset.sha256);
      assert.equal(assetStore.verifyAsset(art.currentVersion.primaryAsset), true);
      assert.equal(createHash('sha256').update(readFileSync(context.source)).digest('hex'),
        context.sourceSha256);
      assert.equal(documentStore.getEvaluation(completed.outputs.evaluate.evaluationId).verdict,
        'ACCEPT');
      assert.equal(documentStore.getHumanReview(completed.outputs['human-review'].reviewId)
        .disposition, 'APPROVE');
      const events = visualStore.listEvents(started.session.sessionId);
      assert.equal(events.at(-1).type, 'SESSION_COMPLETED');
      assert.equal(events.every((event, index) => (
        event.sequence === index + 1
        && (index === 0 || event.previousEventDigest === events[index - 1].eventDigest)
      )), true);
    } finally {
      visualStore.close();
      operatorStore.close();
      documentStore.close();
      assetStore.close();
    }
  } finally {
    if (!initialClosed) {
      context.visualStore.close();
      context.operatorStore.close();
      context.documentStore.close();
      context.assetStore.close();
    }
  }
});
