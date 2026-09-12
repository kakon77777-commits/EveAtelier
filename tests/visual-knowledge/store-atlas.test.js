import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { VisualKnowledgeStore } from '../../src/visual-knowledge/store.js';
import {
  closeKnowledgeWorld,
  setupKnowledgeWorld,
} from './helpers.js';

test('ingests accepted session evidence and builds a derived, deterministic Style Atlas', async () => {
  const context = await setupKnowledgeWorld();
  try {
    assert.equal(context.knowledgeStore.getConceptStatus(context.concept.conceptId), 'ACTIVE');
    assert.equal(context.knowledgeStore.getRecord(
      'SOURCE_IDENTITY',
      `source-identity:${context.started.session.sessionId}:accepted`,
    ).rightsClass, 'RIGHTS_CLEAR');
    assert.equal(context.knowledgeStore.getRecord(
      'WORKFLOW_EXPERIENCE',
      context.ingested.workflowExperienceId,
    ).sessionDigest, context.completed.lastEventDigest);
    assert.equal(context.knowledgeStore.listRecords('PROVIDER_EVIDENCE',
      context.started.session.projectId).length, 3);
    const revisionBeforeReplay = context.knowledgeStore.getProjectRevision(
      context.started.session.projectId,
    );
    assert.equal(context.ingestor.ingest(context.ingestRequest).acceptedReferenceId,
      context.ingested.acceptedReferenceId);
    assert.equal(context.knowledgeStore.getProjectRevision(context.started.session.projectId),
      revisionBeforeReplay);
    assert.ok(context.knowledgeStore.getProjectRevision(context.started.session.projectId) > 0);
    assert.equal(context.knowledgeStore.listLedger(context.started.session.projectId)
      .filter(item => item.event.affectsRevision).length,
    context.knowledgeStore.exportProjectRecords(context.started.session.projectId)
      .conceptStatusEvents.length
      + Object.entries(context.knowledgeStore.exportProjectRecords(context.started.session.projectId))
        .filter(([key]) => key !== 'conceptStatusEvents')
        .reduce((total, [, values]) => total + values.length, 0));

    const atlas = context.atlasSnapshot;
    assert.equal(atlas.referenceCards.length, 4);
    assert.equal(atlas.referenceCards.find(item => (
      item.referenceAssetId === context.privateReference.referenceAssetId
    )).rightsClass, 'PRIVATE_RESEARCH');
    assert.deepEqual(atlas.negativeReferenceAssetIds, [
      context.ingested.initialReferenceId,
      context.secondNegativeReference.referenceAssetId,
    ].sort());
    assert.equal(atlas.favorites[0].referenceAssetId, context.ingested.acceptedReferenceId);
    assert.equal(atlas.favorites[0].score, 1);
    assert.ok(atlas.referenceCards.find(item => (
      item.referenceAssetId === context.ingested.acceptedReferenceId
    )).conceptIds.includes(context.concept.conceptId));
    const styleCluster = atlas.clusters.find(item => (
      item.extractorRef.spaceId === 'style-v1'
    ));
    assert.deepEqual(styleCluster.memberReferenceAssetIds, [
      context.ingested.acceptedReferenceId,
      context.ingested.initialReferenceId,
    ].sort());
    assert.equal(styleCluster.minimumSimilarity, 0.8);
    const otherCluster = atlas.clusters.find(item => item.extractorRef.spaceId === 'other-v1');
    assert.deepEqual(otherCluster.memberReferenceAssetIds, [context.ingested.acceptedReferenceId]);

    const similar = context.atlas.similarReferences({
      projectId: context.started.session.projectId,
      referenceAssetId: context.ingested.acceptedReferenceId,
    });
    assert.deepEqual(similar.map(item => [item.referenceAssetId, item.similarity]), [
      [context.ingested.initialReferenceId, 0.8],
    ]);
  } finally {
    closeKnowledgeWorld(context);
  }
});

test('retrieval retains evidence types and rejects Atlas or selection forgery', async () => {
  const context = await setupKnowledgeWorld();
  try {
    const retrieval = context.retrieval;
    assert.ok(retrieval.selected.referenceAssetIds.includes(context.ingested.acceptedReferenceId));
    assert.ok(retrieval.selected.referenceAssetIds.includes(context.ingested.initialReferenceId));
    assert.ok(retrieval.selected.referenceAssetIds.includes(
      context.secondNegativeReference.referenceAssetId,
    ));
    assert.equal(retrieval.selected.referenceAssetIds.includes(
      context.privateReference.referenceAssetId,
    ), false);
    assert.ok(retrieval.selected.preferenceIds.includes(context.ingested.preferenceIds[0]));
    assert.ok(retrieval.selected.conceptIds.includes(context.concept.conceptId));
    assert.ok(retrieval.selected.styleObservationIds.includes(
      context.styleObservation.observationId,
    ));
    assert.ok(retrieval.selected.artifactEvaluationIds.includes(
      context.ingested.knowledgeEvaluationId,
    ));
    assert.ok(retrieval.selected.failureModeIds.includes(context.failureMode.failureModeId));
    assert.ok(retrieval.selected.providerEvidenceIds.length > 0);
    assert.ok(retrieval.selected.workflowExperienceIds.includes(
      context.ingested.workflowExperienceId,
    ));
    assert.ok(retrieval.selected.semanticRelationIds.includes(context.conceptRelation.relationId));
    assert.equal(retrieval.selectionEvidence.every(item => (
      item.score >= 0 && item.score <= 1 && item.reasons.length > 0
    )), true);

    const forgedAtlas = structuredClone(context.atlasSnapshot);
    forgedAtlas.atlasSnapshotId = 'style-atlas:v04:forged';
    forgedAtlas.referenceCards[0].preferenceScore += 10;
    assert.throws(() => context.knowledgeStore.recordAtlasSnapshot(forgedAtlas),
      /style_atlas_snapshot_forged/);

    const forgedRetrieval = structuredClone(retrieval);
    forgedRetrieval.retrievalContextId = 'retrieval-context:v04:forged';
    forgedRetrieval.selectionEvidence[0].score = 0;
    assert.throws(() => context.knowledgeStore.recordRetrievalContext(forgedRetrieval),
      /visual_retrieval_context_forged/);

    context.knowledgeStore.registerVisualConcept({
      schema: 'eve-atelier-visual-concept/v1',
      conceptId: 'concept:v04:later',
      projectId: context.started.session.projectId,
      conceptKey: 'visual.concept.later',
      version: '1.0.0',
      label: 'Later concept',
      description: 'Added after the first Atlas revision.',
      domain: 'test',
      initialStatus: 'CANDIDATE',
      alternatives: [],
      evidenceRefs: ['evidence:v04:later'],
      evidenceClass: 'UNVERIFIED',
      provenance: { kind: 'AI', id: 'ai:proposal-only' },
      createdAt: '2026-09-12T03:02:00Z',
    });
    const stale = structuredClone(context.atlasSnapshot);
    stale.atlasSnapshotId = 'style-atlas:v04:stale-copy';
    assert.throws(() => context.knowledgeStore.recordAtlasSnapshot(stale),
      /style_atlas_source_stale/);
  } finally {
    closeKnowledgeWorld(context);
  }
});

test('concept mutation is human-gated and all knowledge ledgers survive reopen', async () => {
  const context = await setupKnowledgeWorld();
  let knowledgeClosed = false;
  try {
    assert.throws(() => context.knowledgeStore.appendConceptStatusEvent({
      schema: 'eve-atelier-visual-concept-status-event/v1',
      statusEventId: 'concept-status:v04:ai-deprecate',
      conceptId: context.concept.conceptId,
      projectId: context.concept.projectId,
      fromStatus: 'ACTIVE',
      toStatus: 'DEPRECATED',
      evidenceRefs: ['evidence:v04:ai-claim'],
      actor: { kind: 'AI', id: 'ai:no-theory-authority' },
      occurredAt: '2026-09-12T03:10:00Z',
    }), /visual_concept_status_event_invalid/);
    const beforeRevision = context.knowledgeStore.getProjectRevision(context.concept.projectId);
    const beforeLedger = context.knowledgeStore.listLedger(context.concept.projectId);
    context.knowledgeStore.close();
    knowledgeClosed = true;
    const reopened = new VisualKnowledgeStore({
      path: join(context.root, 'visual-knowledge.sqlite3'),
      assetStore: context.assetStore,
      artDocumentStore: context.documentStore,
      visualIntelligenceStore: context.visualStore,
    });
    try {
      assert.equal(reopened.getProjectRevision(context.concept.projectId), beforeRevision);
      assert.deepEqual(reopened.listLedger(context.concept.projectId), beforeLedger);
      assert.equal(reopened.getConceptStatus(context.concept.conceptId), 'ACTIVE');
      assert.deepEqual(reopened.getRetrievalContext(context.retrieval.retrievalContextId),
        context.retrieval);
      assert.deepEqual(reopened.getAtlasSnapshot(context.atlasSnapshot.atlasSnapshotId),
        context.atlasSnapshot);
    } finally {
      reopened.close();
    }
  } finally {
    if (!knowledgeClosed) context.knowledgeStore.close();
    context.visualStore.close();
    context.operatorStore.close();
    context.documentStore.close();
    context.assetStore.close();
  }
});

test('fresh SQLite connections cannot update, delete, alternate-key replace, or rowid replace', async () => {
  const context = await setupKnowledgeWorld();
  try {
    const attacker = new DatabaseSync(join(context.root, 'visual-knowledge.sqlite3'));
    try {
      assert.equal(Number(attacker.prepare('PRAGMA recursive_triggers').get().recursive_triggers), 0);
      const schemaSql = attacker.prepare(`
        SELECT group_concat(sql, '\n') AS sql FROM sqlite_master WHERE type = 'table'
      `).get().sql;
      assert.equal(/\bBLOB\b|asset_bytes|image_bytes/i.test(schemaSql), false);
      for (const statement of [
        "UPDATE vk_source_identities SET record_json = '{}'",
        'DELETE FROM vk_reference_assets',
        `INSERT OR REPLACE INTO vk_reference_roles (
          role_binding_id, project_id, reference_asset_id, role, scope_key, record_json
        ) SELECT 'role:attacker:alternate', project_id, reference_asset_id, role,
          scope_key, '{}' FROM vk_reference_roles LIMIT 1`,
        `INSERT OR REPLACE INTO vk_provider_evidence (
          provider_evidence_id, project_id, source_execution_id, record_json
        ) SELECT 'provider-evidence:attacker', project_id, source_execution_id, '{}'
          FROM vk_provider_evidence LIMIT 1`,
        `INSERT OR REPLACE INTO vk_reference_assets (
          rowid, reference_asset_id, project_id, asset_id, source_identity_id, record_json
        ) SELECT rowid, 'reference:attacker:rowid', project_id, asset_id,
          source_identity_id, '{}' FROM vk_reference_assets LIMIT 1`,
        `INSERT OR REPLACE INTO vk_ledger (
          event_sequence, ledger_event_id, project_id, record_kind, record_id,
          record_digest, affects_revision, record_json
        ) SELECT event_sequence, 'ledger:attacker', project_id, record_kind,
          record_id, record_digest, affects_revision, '{}' FROM vk_ledger LIMIT 1`,
      ]) {
        assert.throws(() => attacker.exec(statement),
          /append_only_(?:update|delete|replace)_forbidden/, statement);
      }
      const orphan = {
        schema: 'eve-atelier-failure-mode/v1',
        failureModeId: 'failure-mode:attacker:orphan',
        projectId: context.started.session.projectId,
        code: 'ATTACKER_ORPHAN',
        label: 'Orphan',
        description: 'Valid-shaped record inserted without its mandatory ledger event.',
        dimensions: ['STYLE'],
        referenceAssetIds: [],
        status: 'PROVISIONAL',
        evidenceClass: 'UNVERIFIED',
        evidenceRefs: ['evidence:attacker:orphan'],
        provenance: { kind: 'IMPORT', id: 'attacker:test' },
        observedAt: '2026-09-12T03:20:00Z',
      };
      attacker.prepare(`
        INSERT INTO vk_failure_modes (
          failure_mode_id, project_id, failure_code, record_json
        ) VALUES (?, ?, ?, ?)
      `).run(orphan.failureModeId, orphan.projectId, orphan.code, JSON.stringify(orphan));
      assert.throws(() => context.knowledgeStore.verifyProjectLedger(
        context.started.session.projectId,
      ), /visual_knowledge_ledger_count_mismatch/);
    } finally {
      attacker.close();
    }
  } finally {
    closeKnowledgeWorld(context);
  }
});
