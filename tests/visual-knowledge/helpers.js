import { join } from 'node:path';
import { VisualKnowledgeStore } from '../../src/visual-knowledge/store.js';
import { StyleAtlas } from '../../src/visual-knowledge/style-atlas.js';
import { CompletedSessionKnowledgeIngestor } from '../../src/visual-knowledge/session-ingestor.js';
import {
  human,
  setupVisualIntelligence,
  startBackgroundSession,
} from '../visual-intelligence/helpers.js';

export async function setupKnowledgeWorld() {
  const context = await setupVisualIntelligence({ promotionPolicy: 'human_required' });
  const started = startBackgroundSession(context);
  const waiting = await context.controller.run(started.session.sessionId);
  if (waiting.status !== 'WAITING_HUMAN') throw new Error('knowledge_fixture_human_gate_missing');
  context.controller.submitHumanDecision({
    sessionId: started.session.sessionId,
    decision: 'APPROVE',
    reason: 'Preferred for this synthetic project after deterministic alpha and edge review.',
    reviewer: human,
  });
  const completed = await context.controller.run(started.session.sessionId);
  if (completed.status !== 'COMPLETED') throw new Error('knowledge_fixture_session_not_completed');
  const knowledgeStore = new VisualKnowledgeStore({
    path: join(context.root, 'visual-knowledge.sqlite3'),
    assetStore: context.assetStore,
    artDocumentStore: context.documentStore,
    visualIntelligenceStore: context.visualStore,
  });
  context.visualStore.bindVisualKnowledgeStore(knowledgeStore);
  const ingestor = new CompletedSessionKnowledgeIngestor({
    knowledgeStore,
    visualIntelligenceStore: context.visualStore,
    artDocumentStore: context.documentStore,
  });
  const ingestRequest = {
    sessionId: started.session.sessionId,
    initialSource: {
      sourceKind: 'SYNTHETIC',
      canonicalLabel: 'Synthetic source subject',
      rightsClass: 'RIGHTS_CLEAR',
      evidenceClass: 'RIGHTS_CLEAR_REAL',
      evidenceRefs: ['evidence:v04:synthetic-source-rights'],
    },
    acceptedSource: {
      canonicalLabel: 'Accepted synthetic background-removal candidate',
      rightsClass: 'RIGHTS_CLEAR',
      evidenceClass: 'RIGHTS_CLEAR_REAL',
      evidenceRefs: ['evidence:v04:derived-rights-lineage'],
    },
    acceptedReferenceRoles: [{
      role: 'IDENTITY_REFERENCE',
      allowedInfluence: ['IDENTITY', 'CHARACTER_IDENTITY', 'STRUCTURE'],
    }, {
      role: 'LINE_REFERENCE',
      allowedInfluence: ['SURFACE_RENDERING', 'STYLE'],
    }, {
      role: 'COLOR_REFERENCE',
      allowedInfluence: ['COLOR', 'PALETTE_COMPATIBILITY'],
    }, {
      role: 'LIGHTING_REFERENCE',
      allowedInfluence: ['LIGHTING'],
    }],
    rightsActor: human,
    ingestedAt: '2026-09-12T02:00:00Z',
  };
  const ingested = ingestor.ingest(ingestRequest);
  const concept = knowledgeStore.registerVisualConcept({
    schema: 'eve-atelier-visual-concept/v1',
    conceptId: 'concept:v04:fine-line',
    projectId: started.session.projectId,
    conceptKey: 'visual.concept.fine-line',
    version: '1.0.0',
    label: 'Fine line',
    description: 'Thin controlled line rendering for project-local character art.',
    domain: 'character-art',
    initialStatus: 'CANDIDATE',
    alternatives: ['visual.concept.heavy-outline'],
    evidenceRefs: ['evidence:v04:fine-line-observation'],
    evidenceClass: 'CONTRACT_TESTED',
    provenance: { kind: 'AI', id: 'ai:proposal-only' },
    createdAt: '2026-09-12T02:01:00Z',
  });
  knowledgeStore.appendConceptStatusEvent({
    schema: 'eve-atelier-visual-concept-status-event/v1',
    statusEventId: 'concept-status:v04:fine-line:provisional',
    conceptId: concept.conceptId,
    projectId: concept.projectId,
    fromStatus: 'CANDIDATE',
    toStatus: 'PROVISIONAL',
    evidenceRefs: ['evidence:v04:human-concept-review'],
    actor: human,
    occurredAt: '2026-09-12T02:02:00Z',
  });
  knowledgeStore.appendConceptStatusEvent({
    schema: 'eve-atelier-visual-concept-status-event/v1',
    statusEventId: 'concept-status:v04:fine-line:active',
    conceptId: concept.conceptId,
    projectId: concept.projectId,
    fromStatus: 'PROVISIONAL',
    toStatus: 'ACTIVE',
    evidenceRefs: ['evidence:v04:human-concept-activation'],
    actor: human,
    occurredAt: '2026-09-12T02:03:00Z',
  });
  const negativeRole = knowledgeStore.registerReferenceRole({
    schema: 'eve-atelier-reference-role/v1',
    roleBindingId: 'reference-role:v04:negative-face',
    projectId: concept.projectId,
    referenceAssetId: ingested.initialReferenceId,
    role: 'NEGATIVE_REFERENCE',
    allowedInfluence: ['FACE_IDENTITY'],
    scope: { kind: 'PROJECT_LOCAL', projectId: concept.projectId, taskId: null },
    evidenceRefs: ['evidence:v04:negative-face-direction'],
    provenance: { kind: 'HUMAN', id: human.id },
    createdAt: '2026-09-12T02:04:00Z',
  });
  const secondNegativeReference = knowledgeStore.registerReferenceAsset({
    schema: 'eve-atelier-reference-asset/v1',
    referenceAssetId: 'reference-asset:v04:negative-two',
    projectId: concept.projectId,
    assetRef: knowledgeStore.getRecord('REFERENCE_ASSET', ingested.initialReferenceId).assetRef,
    sourceIdentityId: `source-identity:${started.session.sessionId}:initial`,
    labels: ['negative', 'second-control'],
    status: 'ACTIVE',
    evidenceRefs: ['evidence:v04:negative-two'],
    provenance: { kind: 'HUMAN', id: human.id },
    createdAt: '2026-09-12T02:04:00Z',
  });
  const secondNegativeRole = knowledgeStore.registerReferenceRole({
    schema: 'eve-atelier-reference-role/v1',
    roleBindingId: 'reference-role:v04:negative-two',
    projectId: concept.projectId,
    referenceAssetId: secondNegativeReference.referenceAssetId,
    role: 'NEGATIVE_REFERENCE',
    allowedInfluence: ['STYLE'],
    scope: { kind: 'PROJECT_LOCAL', projectId: concept.projectId, taskId: null },
    evidenceRefs: ['evidence:v04:negative-two'],
    provenance: { kind: 'HUMAN', id: human.id },
    createdAt: '2026-09-12T02:04:01Z',
  });
  const privateSource = knowledgeStore.registerSourceIdentity({
    schema: 'eve-atelier-visual-source-identity/v1',
    sourceIdentityId: 'source-identity:v04:private-control',
    projectId: concept.projectId,
    sourceKind: 'GAME_RESEARCH',
    canonicalLabel: 'Private research control',
    rightsClass: 'PRIVATE_RESEARCH',
    evidenceClass: 'PRIVATE_RESEARCH_AUTHORIZED',
    evidenceRefs: ['evidence:v04:private-control'],
    provenance: { kind: 'HUMAN', id: human.id },
    createdAt: '2026-09-12T02:04:02Z',
  });
  const privateReference = knowledgeStore.registerReferenceAsset({
    schema: 'eve-atelier-reference-asset/v1',
    referenceAssetId: 'reference-asset:v04:private-control',
    projectId: concept.projectId,
    assetRef: knowledgeStore.getRecord('REFERENCE_ASSET', ingested.initialReferenceId).assetRef,
    sourceIdentityId: privateSource.sourceIdentityId,
    labels: ['private', 'research-control'],
    status: 'ACTIVE',
    evidenceRefs: ['evidence:v04:private-control'],
    provenance: { kind: 'HUMAN', id: human.id },
    createdAt: '2026-09-12T02:04:03Z',
  });
  const privateRole = knowledgeStore.registerReferenceRole({
    schema: 'eve-atelier-reference-role/v1',
    roleBindingId: 'reference-role:v04:private-control',
    projectId: concept.projectId,
    referenceAssetId: privateReference.referenceAssetId,
    role: 'STYLE_CORE_REFERENCE',
    allowedInfluence: ['STYLE', 'SURFACE_RENDERING'],
    scope: { kind: 'PROJECT_LOCAL', projectId: concept.projectId, taskId: null },
    evidenceRefs: ['evidence:v04:private-control'],
    provenance: { kind: 'HUMAN', id: human.id },
    createdAt: '2026-09-12T02:04:04Z',
  });
  const conceptRelation = knowledgeStore.registerSemanticRelation({
    schema: 'eve-atelier-semantic-relation/v1',
    relationId: 'semantic-relation:v04:accepted-fine-line',
    projectId: concept.projectId,
    layer: 'PERCEPTUAL',
    subject: { kind: 'REFERENCE_ASSET', id: ingested.acceptedReferenceId },
    predicate: 'EXHIBITS',
    object: { kind: 'VISUAL_CONCEPT', id: concept.conceptId },
    confidence: 0.9,
    observerRef: null,
    evidenceClass: 'CONTRACT_TESTED',
    evidenceRefs: ['evidence:v04:fine-line-observation'],
    provenance: { kind: 'RUNTIME', id: 'style-observer:synthetic' },
    createdAt: '2026-09-12T02:04:01Z',
  });
  const styleObservation = knowledgeStore.registerStyleObservation({
    schema: 'eve-atelier-style-observation/v1',
    observationId: 'style-observation:v04:accepted',
    projectId: concept.projectId,
    subjectReferenceAssetId: ingested.acceptedReferenceId,
    comparisonReferenceAssetId: ingested.initialReferenceId,
    evaluator: { kind: 'AI', id: 'evaluator:synthetic-style', version: '1.0.0' },
    conditioning: { kind: 'MODEL', identityRef: 'model:synthetic-observer', version: '1.0.0' },
    dimensions: {
      SURFACE_RENDERING: {
        status: 'MATCH', confidence: 0.8,
        evidenceRefs: ['evidence:v04:surface'], notes: ['Project-local synthetic observation.'],
      },
      PALETTE_COMPATIBILITY: {
        status: 'UNKNOWN', confidence: 0.2,
        evidenceRefs: ['evidence:v04:palette-limit'], notes: ['Not calibrated.'],
      },
    },
    limitations: ['Synthetic fixture; not universal style evidence.'],
    evidenceClass: 'CONTRACT_TESTED',
    evidenceRefs: ['evidence:v04:style-observation'],
    provenance: { kind: 'AI', id: 'evaluator:synthetic-style' },
    createdAt: '2026-09-12T02:05:00Z',
  });
  const failureMode = knowledgeStore.registerFailureMode({
    schema: 'eve-atelier-failure-mode/v1',
    failureModeId: 'failure-mode:v04:white-fringe',
    projectId: concept.projectId,
    code: 'VISIBLE_WHITE_FRINGE',
    label: 'Visible white fringe',
    description: 'Partial-alpha edge pixels retain visible white contamination.',
    dimensions: ['EDGE', 'ALPHA'],
    referenceAssetIds: [ingested.initialReferenceId],
    status: 'OBSERVED',
    evidenceClass: 'CONTRACT_TESTED',
    evidenceRefs: ['evidence:v04:white-fringe-negative'],
    provenance: { kind: 'RUNTIME', id: 'validator:background-removal' },
    observedAt: '2026-09-12T02:06:00Z',
  });
  const extractor = {
    id: 'extractor:synthetic-style', version: '1.0.0', spaceId: 'style-v1', dimensions: 2,
  };
  const featureObservations = [{
    id: 'feature:v04:accepted:style', referenceAssetId: ingested.acceptedReferenceId,
    extractor, vector: [1, 0], time: '2026-09-12T02:07:00Z',
  }, {
    id: 'feature:v04:initial:style', referenceAssetId: ingested.initialReferenceId,
    extractor, vector: [0.8, 0.6], time: '2026-09-12T02:07:01Z',
  }, {
    id: 'feature:v04:accepted:other-space', referenceAssetId: ingested.acceptedReferenceId,
    extractor: {
      id: 'extractor:synthetic-other', version: '1.0.0', spaceId: 'other-v1', dimensions: 2,
    },
    vector: [0, 1], time: '2026-09-12T02:07:02Z',
  }].map(item => knowledgeStore.registerFeatureObservation({
    schema: 'eve-atelier-feature-observation/v1',
    featureObservationId: item.id,
    projectId: concept.projectId,
    referenceAssetId: item.referenceAssetId,
    extractor: item.extractor,
    vector: item.vector,
    normalization: 'L2',
    evidenceClass: 'FIXTURE',
    evidenceRefs: [`evidence:${item.id}`],
    provenance: { kind: 'RUNTIME', id: item.extractor.id },
    createdAt: item.time,
  }));
  const atlas = new StyleAtlas({ store: knowledgeStore });
  const atlasSnapshot = atlas.buildAndRecord({
    projectId: concept.projectId,
    atlasSnapshotId: 'style-atlas:v04:one',
    clusterThreshold: 0.75,
    createdAt: '2026-09-12T03:00:00Z',
  });
  const retrieval = atlas.buildAndRecordRetrieval({
    atlasSnapshotId: atlasSnapshot.atlasSnapshotId,
    retrievalContextId: 'retrieval-context:v04:background-removal',
    query: {
      taskType: 'BACKGROUND_REMOVAL',
      dimensions: ['IDENTITY', 'EDGE', 'ALPHA', 'SURFACE_RENDERING'],
      roles: ['IDENTITY_REFERENCE', 'LINE_REFERENCE', 'NEGATIVE_REFERENCE'],
      allowedRightsClasses: ['RIGHTS_CLEAR'],
      text: 'accepted fine line background removal identity edge',
      limit: 20,
    },
    createdAt: '2026-09-12T03:01:00Z',
  });
  return {
    ...context,
    started,
    completed,
    knowledgeStore,
    ingestor,
    ingestRequest,
    ingested,
    concept,
    negativeRole,
    secondNegativeReference,
    secondNegativeRole,
    privateSource,
    privateReference,
    privateRole,
    conceptRelation,
    styleObservation,
    failureMode,
    featureObservations,
    atlas,
    atlasSnapshot,
    retrieval,
  };
}

export function closeKnowledgeWorld(context) {
  context.knowledgeStore.close();
  context.visualStore.close();
  context.operatorStore.close();
  context.documentStore.close();
  context.assetStore.close();
}
