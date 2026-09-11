import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { VisualIntelligenceStore } from '../../src/visual-intelligence/session-store.js';
import { RabclRuntime } from '../../src/visual-intelligence/rabcl-runtime.js';
import {
  closeVisualIntelligence,
  setupVisualIntelligence,
  startBackgroundSession,
} from './helpers.js';

const zeroUsage = {
  iterations: 0,
  providerCalls: 0,
  candidates: 0,
  repairLoops: 0,
  costUnits: 0,
  latencyMs: 0,
};

test('reconstructs session chain, outputs, usage, and in-flight recovery after reopen', async () => {
  const context = await setupVisualIntelligence();
  let closed = false;
  try {
    const started = startBackgroundSession(context);
    context.visualStore.appendEvent({
      eventId: 'aads-event:session:v03:background-removal:2:node_started',
      sessionId: started.session.sessionId,
      expectedSequence: 1,
      type: 'NODE_STARTED',
      nodeId: 'create-mask',
      decision: null,
      output: { nextNodeId: 'create-mask' },
      usageDelta: { ...zeroUsage, iterations: 1 },
      evidenceRefs: ['evidence:v03:synthetic-in-flight'],
      actor: { kind: 'SYSTEM', id: 'aads-runtime:v1' },
      occurredAt: '2026-09-11T05:00:00Z',
    });
    const before = context.visualStore.getSessionSnapshot(started.session.sessionId);
    assert.equal(before.inFlightNodeId, 'create-mask');
    assert.equal(before.usage.iterations, 1);
    context.visualStore.close();
    closed = true;

    const reopened = new VisualIntelligenceStore({
      path: join(context.root, 'visual-intelligence.sqlite3'),
      artDocumentStore: context.documentStore,
      operatorStore: context.operatorStore,
      assetStore: context.assetStore,
    });
    try {
      const after = reopened.getSessionSnapshot(started.session.sessionId);
      assert.equal(after.lastEventDigest, before.lastEventDigest);
      assert.deepEqual(after.usage, before.usage);
      assert.deepEqual(after.outputs, before.outputs);
      assert.equal(after.inFlightNodeId, 'create-mask');
      let providerCalls = 0;
      const adapter = {
        getArtSnapshot: id => context.documentStore.getDocumentSnapshot(id),
        async executeOperator() { providerCalls += 1; return null; },
        evaluate() { throw new Error('not_expected'); },
        recordHumanReview() { throw new Error('not_expected'); },
        promote() { throw new Error('not_expected'); },
      };
      const runtime = new RabclRuntime({
        store: reopened,
        adapter,
        now: () => '2026-09-11T05:00:01Z',
      });
      const stopped = await runtime.run(started.session.sessionId);
      assert.equal(stopped.status, 'STOPPED');
      assert.equal(stopped.terminalOutcome, 'FAILED');
      assert.equal(providerCalls, 0);
      assert.equal(stopped.usage.providerCalls, 1);
      assert.match(stopped.lastEventDigest, /^[a-f0-9]{64}$/);
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) context.visualStore.close();
    context.operatorStore.close();
    context.documentStore.close();
    context.assetStore.close();
  }
});

test('rejects stale event append and SQL mutation, alternate unique, and implicit rowid replace', async () => {
  const context = await setupVisualIntelligence();
  try {
    const started = startBackgroundSession(context);
    context.controller.projectContext({
      contextSnapshotId: started.context.contextSnapshotId,
      projectionId: 'projection:v03:sql-control',
      profile: {
        schema: 'eve-atelier-worker-context-profile/v1',
        profileId: 'worker-profile:v03:sql-control',
        purpose: 'SQL immutability control.',
        allowedSections: ['GLOSSARY'],
        maxEntriesPerSection: 1,
        createdAt: '2026-09-11T03:59:00Z',
      },
    });
    assert.throws(() => context.visualStore.appendEvent({
      eventId: 'aads-event:v03:stale',
      sessionId: started.session.sessionId,
      expectedSequence: 0,
      type: 'SESSION_STOPPED',
      nodeId: 'stop-failed',
      decision: 'STOP',
      output: { outcome: 'FAILED', nextNodeId: null },
      usageDelta: { ...zeroUsage, providerCalls: 1 },
      evidenceRefs: ['evidence:v03:stale'],
      actor: { kind: 'SYSTEM', id: 'aads-runtime:v1' },
      occurredAt: '2026-09-11T05:01:00Z',
    }), /aads_session_event_stale:1/);
    assert.throws(() => context.visualStore.appendEvent({
      eventId: 'aads-event:v03:bypass-human-gate',
      sessionId: started.session.sessionId,
      expectedSequence: 1,
      type: 'HUMAN_DECISION',
      nodeId: 'create-mask',
      decision: 'ACCEPT',
      output: { reviewId: 'review:forged', nextNodeId: 'promote' },
      usageDelta: zeroUsage,
      evidenceRefs: ['evidence:v03:forged'],
      actor: { kind: 'HUMAN', id: 'human:forged' },
      occurredAt: '2026-09-11T05:01:01Z',
    }), /rabcl_human_decision_transition_invalid/);
    assert.throws(() => context.visualStore.appendEvent({
      eventId: 'aads-event:v03:success-without-start',
      sessionId: started.session.sessionId,
      expectedSequence: 1,
      type: 'NODE_SUCCEEDED',
      nodeId: 'create-mask',
      decision: null,
      output: { nextNodeId: 'create-alpha' },
      usageDelta: { ...zeroUsage, providerCalls: 1 },
      evidenceRefs: ['evidence:v03:forged'],
      actor: { kind: 'SYSTEM', id: 'aads-runtime:v1' },
      occurredAt: '2026-09-11T05:01:02Z',
    }), /rabcl_node_terminal_without_start/);
    assert.throws(() => context.visualStore.appendEvent({
      eventId: 'aads-event:v03:forged-usage',
      sessionId: started.session.sessionId,
      expectedSequence: 1,
      type: 'NODE_STARTED',
      nodeId: 'create-mask',
      decision: null,
      output: { nextNodeId: 'create-mask' },
      usageDelta: zeroUsage,
      evidenceRefs: ['evidence:v03:forged-usage'],
      actor: { kind: 'SYSTEM', id: 'aads-runtime:v1' },
      occurredAt: '2026-09-11T05:01:03Z',
    }), /aads_node_start_usage_invalid/);

    const attacker = new DatabaseSync(join(context.root, 'visual-intelligence.sqlite3'));
    try {
      assert.equal(Number(attacker.prepare('PRAGMA recursive_triggers').get().recursive_triggers), 0);
      for (const statement of [
        "UPDATE vi_sessions SET record_json = '{}'",
        "UPDATE vi_worker_profiles SET record_json = '{}'",
        'DELETE FROM vi_intents',
        `INSERT OR REPLACE INTO vi_constraint_packets (
          packet_id, intent_id, project_id, document_id, record_json
        ) SELECT 'packet:attacker:alternate', intent_id, project_id, document_id, '{}'
          FROM vi_constraint_packets LIMIT 1`,
        `INSERT OR REPLACE INTO vi_events (
          event_sequence, event_id, session_id, session_sequence, event_digest,
          event_type, node_id, record_json
        ) SELECT event_sequence, 'event:attacker:alternate', session_id,
          session_sequence, '${'0'.repeat(64)}', event_type, node_id, '{}'
          FROM vi_events LIMIT 1`,
        `INSERT OR REPLACE INTO vi_context_snapshots (
          rowid, context_snapshot_id, project_id, context_version, record_json
        ) SELECT rowid, 'context:attacker:rowid', project_id,
          context_version + 100, '{}' FROM vi_context_snapshots LIMIT 1`,
        `INSERT OR REPLACE INTO vi_worker_projections (
          rowid, projection_id, context_snapshot_id, profile_id, context_digest,
          record_json
        ) SELECT rowid, 'projection:attacker:rowid', context_snapshot_id,
          profile_id, context_digest, '{}' FROM vi_worker_projections LIMIT 1`,
      ]) {
        assert.throws(
          () => attacker.exec(statement),
          /append_only_(?:update|delete|replace)_forbidden/,
          statement,
        );
      }
    } finally {
      attacker.close();
    }
  } finally {
    closeVisualIntelligence(context);
  }
});
