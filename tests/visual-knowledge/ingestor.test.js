import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { VisualKnowledgeStore } from '../../src/visual-knowledge/store.js';
import { CompletedSessionKnowledgeIngestor } from '../../src/visual-knowledge/session-ingestor.js';
import {
  human,
  sessionBudget,
  setupVisualIntelligence,
  startBackgroundSession,
} from '../visual-intelligence/helpers.js';

function classifications(rightsClass = 'RIGHTS_CLEAR') {
  const evidenceClass = rightsClass === 'RIGHTS_CLEAR'
    ? 'RIGHTS_CLEAR_REAL'
    : rightsClass === 'PRIVATE_RESEARCH'
      ? 'PRIVATE_RESEARCH_AUTHORIZED'
      : 'UNVERIFIED';
  return {
    initialSource: {
      sourceKind: 'SYNTHETIC',
      canonicalLabel: 'Synthetic source',
      rightsClass,
      evidenceClass,
      evidenceRefs: ['evidence:v04:source-classification'],
    },
    acceptedSource: {
      canonicalLabel: 'Synthetic accepted candidate',
      rightsClass,
      evidenceClass,
      evidenceRefs: ['evidence:v04:accepted-classification'],
    },
  };
}

test('stopped/waiting sessions, rights escalation, and invalid late roles leave no partial knowledge', async () => {
  const context = await setupVisualIntelligence({ promotionPolicy: 'human_required' });
  let knowledgeStore;
  try {
    const started = startBackgroundSession(context);
    const waiting = await context.controller.run(started.session.sessionId);
    assert.equal(waiting.status, 'WAITING_HUMAN');
    knowledgeStore = new VisualKnowledgeStore({
      path: join(context.root, 'visual-knowledge.sqlite3'),
      assetStore: context.assetStore,
      artDocumentStore: context.documentStore,
      visualIntelligenceStore: context.visualStore,
    });
    const ingestor = new CompletedSessionKnowledgeIngestor({
      knowledgeStore,
      visualIntelligenceStore: context.visualStore,
      artDocumentStore: context.documentStore,
    });
    assert.throws(() => ingestor.ingest({
      sessionId: started.session.sessionId,
      ...classifications(),
      acceptedReferenceRoles: [],
      rightsActor: human,
      ingestedAt: '2026-09-12T02:00:00Z',
    }), /knowledge_ingestor_session_not_accepted/);
    assert.equal(knowledgeStore.getProjectRevision(started.session.projectId), 0);

    context.controller.submitHumanDecision({
      sessionId: started.session.sessionId,
      decision: 'APPROVE',
      reason: 'Synthetic project acceptance.',
      reviewer: human,
    });
    const completed = await context.controller.run(started.session.sessionId);
    assert.equal(completed.status, 'COMPLETED');

    assert.throws(() => ingestor.ingest({
      sessionId: started.session.sessionId,
      ...classifications(),
      acceptedReferenceRoles: [],
      ingestedAt: '2026-09-12T02:00:30Z',
    }), /knowledge_ingestor_rights_actor_required/);
    assert.equal(knowledgeStore.getProjectRevision(started.session.projectId), 0);

    const privateInput = classifications('PRIVATE_RESEARCH');
    privateInput.acceptedSource.rightsClass = 'RIGHTS_CLEAR';
    privateInput.acceptedSource.evidenceClass = 'RIGHTS_CLEAR_REAL';
    assert.throws(() => ingestor.ingest({
      sessionId: started.session.sessionId,
      ...privateInput,
      acceptedReferenceRoles: [],
      rightsActor: human,
      ingestedAt: '2026-09-12T02:01:00Z',
    }), /knowledge_ingestor_rights_escalation_forbidden/);
    assert.equal(knowledgeStore.getProjectRevision(started.session.projectId), 0);

    assert.throws(() => ingestor.ingest({
      sessionId: started.session.sessionId,
      ...classifications(),
      acceptedReferenceRoles: [{
        role: 'LINE_REFERENCE',
        allowedInfluence: ['SURFACE_RENDERING', 'FACE_IDENTITY'],
      }],
      rightsActor: human,
      ingestedAt: '2026-09-12T02:02:00Z',
    }), /visual_reference_role_identity_influence_forbidden/);
    assert.equal(knowledgeStore.getProjectRevision(started.session.projectId), 0);
    assert.throws(() => knowledgeStore.getRecord(
      'SOURCE_IDENTITY',
      `source-identity:${started.session.sessionId}:initial`,
    ), /visual_knowledge_record_not_found/);
  } finally {
    knowledgeStore?.close();
    context.visualStore.close();
    context.operatorStore.close();
    context.documentStore.close();
    context.assetStore.close();
  }
});

test('records a stopped workflow as uncertain history without treating it as acceptance', async () => {
  const context = await setupVisualIntelligence({ promotionPolicy: 'human_required' });
  let knowledgeStore;
  try {
    const started = startBackgroundSession(context, {
      sessionId: 'session:v04:budget-stop',
      packetId: 'packet:v04:budget-stop',
      planId: 'plan:v04:budget-stop',
      workflowId: 'workflow:v04:budget-stop',
      contextSnapshotId: 'context:v04:budget-stop',
      intent: { intentId: 'intent:v04:budget-stop' },
      budget: sessionBudget({ maxProviderCalls: 0, maxCandidates: 0 }),
    });
    const stopped = await context.controller.run(started.session.sessionId);
    assert.equal(stopped.terminalOutcome, 'BUDGET_EXHAUSTED');
    knowledgeStore = new VisualKnowledgeStore({
      path: join(context.root, 'visual-knowledge.sqlite3'),
      assetStore: context.assetStore,
      artDocumentStore: context.documentStore,
      visualIntelligenceStore: context.visualStore,
    });
    const workflow = context.visualStore.getWorkflow(started.session.workflowId);
    const experience = knowledgeStore.registerWorkflowExperience({
      schema: 'eve-atelier-workflow-experience/v1',
      workflowExperienceId: 'workflow-experience:v04:budget-stop',
      projectId: started.session.projectId,
      sessionId: started.session.sessionId,
      sessionDigest: stopped.lastEventDigest,
      workflowId: started.session.workflowId,
      taskType: started.session.taskType,
      outcome: 'UNCERTAIN',
      operatorRefs: workflow.nodes.filter(node => node.kind === 'OPERATOR')
        .map(node => node.operatorRef),
      providerEvidenceRefs: [],
      artifactEvaluationRefs: [],
      preferenceRefs: [],
      failureModeRefs: [],
      budgetUse: stopped.usage,
      evidenceClass: 'CONTRACT_TESTED',
      evidenceRefs: ['evidence:v04:budget-stop'],
      provenance: { kind: 'IMPORT', id: 'eve-atelier:aads-runtime' },
      occurredAt: '2026-09-12T02:10:00Z',
    });
    assert.equal(experience.outcome, 'UNCERTAIN');
    assert.equal(knowledgeStore.listRecords('ARTIFACT_EVALUATION',
      started.session.projectId).length, 0);
  } finally {
    knowledgeStore?.close();
    context.visualStore.close();
    context.operatorStore.close();
    context.documentStore.close();
    context.assetStore.close();
  }
});
