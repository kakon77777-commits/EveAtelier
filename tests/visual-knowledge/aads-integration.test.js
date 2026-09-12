import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AadsController } from '../../src/visual-intelligence/controller.js';
import { VisualIntelligenceStore } from '../../src/visual-intelligence/session-store.js';
import { VisualKnowledgeStore } from '../../src/visual-knowledge/store.js';
import { bindReferenceDrivenIntent } from '../../src/visual-knowledge/reference-intent.js';
import {
  advancingClock,
  backgroundIntent,
  providerPolicy,
  sessionAuthority,
  sessionBudget,
} from '../visual-intelligence/helpers.js';
import { setupKnowledgeWorld } from './helpers.js';

function close(context) {
  context.knowledgeStore.close();
  context.visualStore.close();
  context.operatorStore.close();
  context.documentStore.close();
  context.assetStore.close();
}

test('binds explicit line/color/negative roles and retrieval into AADS before planning', async () => {
  const context = await setupKnowledgeWorld();
  try {
    const intent = bindReferenceDrivenIntent({
      baseIntent: backgroundIntent({
        intentId: 'intent:v04:retrieval-bound',
        text: '沿用接受稿的線與色，去掉背景；不要繼承負面參考的臉。',
      }),
      directives: [{
        directiveId: 'directive:v04:line',
        roleBindingId: `reference-role:${context.started.session.sessionId}:2`,
      }, {
        directiveId: 'directive:v04:color',
        roleBindingId: `reference-role:${context.started.session.sessionId}:3`,
      }, {
        directiveId: 'directive:v04:light',
        roleBindingId: `reference-role:${context.started.session.sessionId}:4`,
      }, {
        directiveId: 'directive:v04:avoid-face',
        roleBindingId: context.negativeRole.roleBindingId,
      }],
      knowledgeStore: context.knowledgeStore,
    });
    assert.deepEqual(intent.references.map(item => item.role), [
      'POSITIVE_STYLE', 'COLOR', 'LIGHTING', 'NEGATIVE',
    ]);
    assert.ok(intent.references[3].appliesTo.includes('IDENTITY'));
    const privateIntent = bindReferenceDrivenIntent({
      baseIntent: backgroundIntent({ intentId: 'intent:v04:private-reference' }),
      directives: [{
        directiveId: 'directive:v04:private-style',
        roleBindingId: context.privateRole.roleBindingId,
      }],
      knowledgeStore: context.knowledgeStore,
    });
    assert.ok(privateIntent.hardConstraints.some(item => (
      item.dimension === 'PRIVACY'
      && item.requirement === `LOCAL_ONLY_REFERENCE:${context.privateReference.referenceAssetId}`
    )));
    const controller = new AadsController({
      store: context.visualStore,
      operatorStore: context.operatorStore,
      adapter: context.adapter,
      knowledgeStore: context.knowledgeStore,
      now: advancingClock('2026-09-12T04:00:00Z'),
    });
    assert.throws(() => controller.startSession({
      intent: privateIntent,
      sessionId: 'session:v04:private-reference',
      packetId: 'packet:v04:private-reference',
      planId: 'plan:v04:private-reference',
      workflowId: 'workflow:v04:private-reference',
      contextSnapshotId: 'context:v04:private-reference',
      contextVersion: 2,
      packRef: context.packRef,
      providerPolicy: {
        ...providerPolicy(context.capability),
        allowedPrivacy: ['REMOTE_PRIVATE'],
      },
      budget: sessionBudget(),
      authority: sessionAuthority(),
    }), /aads_private_reference_requires_local_provider/);
    const started = controller.startSession({
      intent,
      sessionId: 'session:v04:retrieval-bound',
      packetId: 'packet:v04:retrieval-bound',
      planId: 'plan:v04:retrieval-bound',
      workflowId: 'workflow:v04:retrieval-bound',
      contextSnapshotId: 'context:v04:retrieval-bound',
      contextVersion: 2,
      packRef: context.packRef,
      providerPolicy: providerPolicy(context.capability),
      budget: sessionBudget(),
      authority: sessionAuthority(),
      glossary: [{
        term: 'retrieval-bound',
        meaning: 'Planning input cites an exact retained visual retrieval context.',
      }],
      evidenceRefs: ['evidence:v04:aads-retrieval-binding'],
      retrievalContextRefs: [context.retrieval.retrievalContextId],
    });
    assert.equal(started.packet.schema, 'eve-atelier-constraint-packet/v2');
    assert.deepEqual(started.packet.retrievalContextRefs, [context.retrieval.retrievalContextId]);
    assert.equal(started.context.schema, 'eve-atelier-project-context-snapshot/v2');
    assert.deepEqual(started.context.retrievalContextRefs, [context.retrieval.retrievalContextId]);
    assert.equal(started.context.sourceAuthorities.semanticStore, 'eve-atelier:sedb-visual');
    assert.equal(started.plan.taskType, 'BACKGROUND_REMOVAL');

    const projection = controller.projectContext({
      contextSnapshotId: started.context.contextSnapshotId,
      projectionId: 'worker-projection:v04:retrieval-only',
      profile: {
        schema: 'eve-atelier-worker-context-profile/v1',
        profileId: 'worker-profile:v04:retrieval-only',
        purpose: 'Read exact retrieval and document identities without knowledge write-back.',
        allowedSections: ['DOCUMENTS', 'RETRIEVAL', 'AUTHORITIES'],
        maxEntriesPerSection: 10,
        createdAt: '2026-09-12T03:59:00Z',
      },
    });
    assert.deepEqual(projection.sections.RETRIEVAL, [context.retrieval.retrievalContextId]);
    assert.equal(projection.authority.writeBack, false);
    assert.equal(JSON.stringify(projection).includes('dimensionResults'), false);
  } finally {
    close(context);
  }
});

test('retrieval binding requires an injected knowledge authority and survives intelligence-store reopen', async () => {
  const context = await setupKnowledgeWorld();
  let visualClosed = false;
  let knowledgeClosed = false;
  try {
    const noKnowledge = new AadsController({
      store: context.visualStore,
      operatorStore: context.operatorStore,
      adapter: context.adapter,
      now: advancingClock('2026-09-12T04:10:00Z'),
    });
    assert.throws(() => noKnowledge.startSession({
      intent: backgroundIntent({ intentId: 'intent:v04:no-knowledge' }),
      sessionId: 'session:v04:no-knowledge',
      packetId: 'packet:v04:no-knowledge',
      planId: 'plan:v04:no-knowledge',
      workflowId: 'workflow:v04:no-knowledge',
      contextSnapshotId: 'context:v04:no-knowledge',
      contextVersion: 2,
      packRef: context.packRef,
      providerPolicy: providerPolicy(context.capability),
      budget: sessionBudget(),
      authority: sessionAuthority(),
      retrievalContextRefs: [context.retrieval.retrievalContextId],
    }), /aads_knowledge_store_required_for_retrieval/);
    assert.throws(() => context.visualStore.getIntent('intent:v04:no-knowledge'),
      /aads_intent_not_found/);

    const privateKnowledge = {
      getRetrievalContext: () => ({
        ...structuredClone(context.retrieval),
        retrievalContextId: 'retrieval-context:v04:private-policy-control',
        query: {
          ...structuredClone(context.retrieval.query),
          allowedRightsClasses: ['PRIVATE_RESEARCH'],
        },
      }),
    };
    const privacyController = new AadsController({
      store: context.visualStore,
      operatorStore: context.operatorStore,
      adapter: context.adapter,
      knowledgeStore: privateKnowledge,
      now: advancingClock('2026-09-12T04:15:00Z'),
    });
    assert.throws(() => privacyController.startSession({
      intent: backgroundIntent({ intentId: 'intent:v04:private-remote' }),
      sessionId: 'session:v04:private-remote',
      packetId: 'packet:v04:private-remote',
      planId: 'plan:v04:private-remote',
      workflowId: 'workflow:v04:private-remote',
      contextSnapshotId: 'context:v04:private-remote',
      contextVersion: 2,
      packRef: context.packRef,
      providerPolicy: {
        ...providerPolicy(context.capability),
        allowedPrivacy: ['REMOTE_PUBLIC'],
      },
      budget: sessionBudget(),
      authority: sessionAuthority(),
      retrievalContextRefs: ['retrieval-context:v04:private-policy-control'],
    }), /aads_private_retrieval_remote_public_forbidden/);

    const controller = new AadsController({
      store: context.visualStore,
      operatorStore: context.operatorStore,
      adapter: context.adapter,
      knowledgeStore: context.knowledgeStore,
      now: advancingClock('2026-09-12T04:20:00Z'),
    });
    controller.startSession({
      intent: backgroundIntent({ intentId: 'intent:v04:reopen' }),
      sessionId: 'session:v04:reopen',
      packetId: 'packet:v04:reopen',
      planId: 'plan:v04:reopen',
      workflowId: 'workflow:v04:reopen',
      contextSnapshotId: 'context:v04:reopen',
      contextVersion: 2,
      packRef: context.packRef,
      providerPolicy: providerPolicy(context.capability),
      budget: sessionBudget(),
      authority: sessionAuthority(),
      retrievalContextRefs: [context.retrieval.retrievalContextId],
    });
    const knowledgeRevision = context.knowledgeStore.getProjectRevision(
      context.started.session.projectId,
    );
    context.visualStore.close();
    visualClosed = true;
    context.knowledgeStore.close();
    knowledgeClosed = true;
    const reopened = new VisualIntelligenceStore({
      path: join(context.root, 'visual-intelligence.sqlite3'),
      artDocumentStore: context.documentStore,
      operatorStore: context.operatorStore,
      assetStore: context.assetStore,
    });
    const reopenedKnowledge = new VisualKnowledgeStore({
      path: join(context.root, 'visual-knowledge.sqlite3'),
      assetStore: context.assetStore,
      artDocumentStore: context.documentStore,
      visualIntelligenceStore: reopened,
    });
    reopened.bindVisualKnowledgeStore(reopenedKnowledge);
    try {
      assert.deepEqual(reopened.getConstraintPacket('packet:v04:reopen').retrievalContextRefs,
        [context.retrieval.retrievalContextId]);
      assert.deepEqual(reopened.getContextSnapshot('context:v04:reopen').retrievalContextRefs,
        [context.retrieval.retrievalContextId]);
      assert.equal(reopened.getSessionSnapshot('session:v04:reopen').status, 'ACTIVE');
      assert.deepEqual(reopenedKnowledge.getRetrievalContext(
        context.retrieval.retrievalContextId,
      ), context.retrieval);
      assert.equal(reopenedKnowledge.verifyProjectLedger(context.started.session.projectId)
        .revision, knowledgeRevision);
    } finally {
      reopenedKnowledge.close();
      reopened.close();
    }
  } finally {
    if (!knowledgeClosed) context.knowledgeStore.close();
    if (!visualClosed) context.visualStore.close();
    context.operatorStore.close();
    context.documentStore.close();
    context.assetStore.close();
  }
});
