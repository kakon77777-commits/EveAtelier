import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoWorkbenchRuntime } from '../../src/product-surface/demo-runtime.js';
import {
  HumanWorkbenchSurface,
  sortHumanHistory,
} from '../../src/product-surface/service.js';

async function demo() {
  const root = await mkdtemp(join(tmpdir(), 'eve-v05-service-'));
  return createDemoWorkbenchRuntime({ root });
}

function backgroundCommand(runtime) {
  return {
    projectId: runtime.projectId,
    documentId: runtime.documentId,
    text: '把背景去掉，邊緣不要有白邊。',
    taskTypeHint: 'UNKNOWN',
    roleBindingIds: ['reference-role:v05:line'],
    preferences: [],
    hardConstraints: [],
    overrides: [],
    retrievalContextRefs: [],
  };
}

test('projects the six human surfaces without local paths or provider controls', async () => {
  const runtime = await demo();
  try {
    const workspace = runtime.surface.getWorkspace({
      projectId: runtime.projectId,
      documentId: runtime.documentId,
    });
    assert.equal(workspace.schema, 'eve-atelier-human-workspace/v1');
    assert.equal(workspace.canvas.currentVersionId, 'version:v05:source');
    assert.match(workspace.canvas.asset.url, /^\/api\/assets\?/);
    assert.equal(workspace.referenceBoard.length, 1);
    assert.deepEqual(workspace.referenceBoard[0].roleBindings.map(item => item.role), [
      'COLOR_REFERENCE', 'IDENTITY_REFERENCE', 'LINE_REFERENCE',
    ]);
    assert.deepEqual(workspace.candidateCompare, []);
    assert.deepEqual(workspace.reviewQueue, []);
    assert.equal(workspace.history.length, 1);
    const serialized = JSON.stringify(workspace);
    assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]|\\\\|\/tmp\//i);
    assert.doesNotMatch(serialized, /providerId|checkpoint|modelId|localPath/i);
  } finally {
    runtime.close();
  }
});

test('intent to candidate to human approval flows through AADS before promotion', async () => {
  const runtime = await demo();
  try {
    const started = await runtime.surface.submitIntent(backgroundCommand(runtime));
    assert.equal(started.session.status, 'WAITING_HUMAN');
    assert.equal(started.workspace.candidateCompare.length, 1);
    assert.equal(started.workspace.reviewQueue.length, 1);
    assert.equal(started.workspace.canvas.currentVersionId, 'version:v05:source');
    const candidateId = started.workspace.candidateCompare[0].versionId;

    const reviewed = await runtime.surface.submitReview({
      projectId: runtime.projectId,
      documentId: runtime.documentId,
      sessionId: started.session.session.sessionId,
      decision: 'APPROVE',
      reason: 'Alpha and edge evidence are acceptable for this synthetic demo.',
    });
    assert.equal(reviewed.session.status, 'COMPLETED');
    assert.equal(reviewed.session.terminalOutcome, 'ACCEPTED');
    assert.equal(reviewed.workspace.canvas.currentVersionId, candidateId);
    assert.equal(reviewed.workspace.candidateCompare[0].review.disposition, 'APPROVE');
    assert.equal(reviewed.workspace.history.some(item => item.type === 'HUMAN_DECISION'), true);
    assert.equal(reviewed.workspace.history.some(item => item.type === 'PROMOTE'), true);
  } finally {
    runtime.close();
  }
});

test('human rejection remains durable and never changes current', async () => {
  const runtime = await demo();
  try {
    const started = await runtime.surface.submitIntent(backgroundCommand(runtime));
    const rejected = await runtime.surface.submitReview({
      projectId: runtime.projectId,
      documentId: runtime.documentId,
      sessionId: started.session.session.sessionId,
      decision: 'REJECT',
      reason: 'Keep the original for this demo.',
    });
    assert.equal(rejected.session.status, 'STOPPED');
    assert.equal(rejected.session.terminalOutcome, 'REJECTED');
    assert.equal(rejected.workspace.canvas.currentVersionId, 'version:v05:source');
    assert.equal(rejected.workspace.candidateCompare[0].review.disposition, 'REJECT');
  } finally {
    runtime.close();
  }
});

test('surface commands reject implementation authority and cross-scope review', async () => {
  const runtime = await demo();
  try {
    assert.rejects(() => runtime.surface.submitIntent({
      ...backgroundCommand(runtime),
      providerId: 'client-must-not-select-provider',
    }), /human_surface_intent_command_invalid/);
    assert.rejects(() => runtime.surface.submitReview({
      projectId: runtime.projectId,
      documentId: runtime.documentId,
      sessionId: 'session:other-project',
      decision: 'APPROVE',
      reason: 'Cross-scope attempt.',
    }), /aads_session_not_found/);
  } finally {
    runtime.close();
  }
});

test('a surface cannot review an existing session outside its authorized workspace', async () => {
  const runtime = await demo();
  try {
    const started = await runtime.surface.submitIntent(backgroundCommand(runtime));
    const rogue = new HumanWorkbenchSurface({
      artDocumentStore: runtime.artDocumentStore,
      assetStore: runtime.assetStore,
      visualIntelligenceStore: runtime.visualIntelligenceStore,
      knowledgeStore: runtime.knowledgeStore,
      controller: runtime.controller,
      sessionPolicy: () => ({}),
      humanActor: { kind: 'HUMAN', id: 'human:other-workspace' },
      now: () => '2026-09-14T01:00:00Z',
      idFactory: kind => `${kind}:other-workspace`,
      defaultWorkspace: { projectId: 'project:other', documentId: 'document:other' },
    });
    await assert.rejects(() => rogue.submitReview({
      projectId: 'project:other',
      documentId: 'document:other',
      sessionId: started.session.session.sessionId,
      decision: 'APPROVE',
      reason: 'Must not cross the authorized workspace boundary.',
    }), /human_surface_review_session_scope_mismatch/);
    assert.equal(runtime.visualIntelligenceStore.getSessionSnapshot(
      started.session.session.sessionId,
    ).status, 'WAITING_HUMAN');
    assert.equal(runtime.artDocumentStore.getDocumentSnapshot(
      runtime.documentId,
    ).currentVersion.versionId, 'version:v05:source');
    assert.deepEqual(runtime.artDocumentStore.listHumanReviews(runtime.documentId), []);
  } finally {
    runtime.close();
  }
});

test('history ordering uses absolute time across canonical RFC3339 offsets', () => {
  const earlier = {
    historyId: 'art:earlier',
    at: '2026-09-14T10:00:00+09:00',
  };
  const later = {
    historyId: 'aads:later',
    at: '2026-09-14T02:00:00Z',
  };
  assert.deepEqual(sortHumanHistory([later, earlier]).map(item => item.historyId), [
    'art:earlier', 'aads:later',
  ]);
});
