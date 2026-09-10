import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetStore } from '../../src/art-domain/asset-store.js';
import { ArtDocumentStore } from '../../src/art-domain/store.js';
import { ArtTargetResolver } from '../../src/art-domain/target-resolver.js';
import { WorkbenchExecutionBridge } from '../../src/art-domain/workbench-runtime.js';
import {
  documentRecord,
  projectRecord,
  sourceTarget,
  writeSubject,
} from './helpers.js';

const t0 = '2026-09-11T01:00:00+08:00';
const t1 = '2026-09-11T01:01:00+08:00';
const t2 = '2026-09-11T01:02:00+08:00';
const t3 = '2026-09-11T01:03:00+08:00';
const human = { kind: 'HUMAN', id: 'human:synthetic-reviewer' };

async function setup({ buildComponents = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-core-'));
  const source = join(root, 'source.png');
  await writeSubject(source);
  const assetStore = new AssetStore({ root: join(root, 'assets') });
  const sourceAsset = assetStore.registerFile({
    sourcePath: source,
    mediaType: 'image/png',
    registeredAt: t0,
  });
  const documentStore = new ArtDocumentStore({
    path: join(root, 'art.sqlite3'),
    assetStore,
  });
  documentStore.registerProject(projectRecord());
  const bridge = new WorkbenchExecutionBridge({
    assetStore,
    documentStore,
    operatorStore: {},
    targetResolver: {},
    providers: [],
    manifests: [],
    stagingRoot: join(root, 'staging'),
  });
  await bridge.createDocumentFromSource({
    document: documentRecord(),
    sourcePath: source,
    mediaType: 'image/png',
    sourceVersionId: 'version:synthetic:v0',
    assetBindingId: 'binding:synthetic:v0:primary',
    currentEventId: 'current:synthetic:initial',
    actor: human,
    occurredAt: t0,
    components: buildComponents === null
      ? {}
      : buildComponents({
          asset: sourceAsset,
          document: documentRecord(),
          versionId: 'version:synthetic:v0',
        }),
  });
  return { root, source, assetStore, documentStore };
}

test('content-addressed registration preserves bytes after source mutation and detects CAS tampering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-cas-'));
  const source = join(root, 'source.png');
  await writeSubject(source);
  const original = readFileSync(source);
  const assetRoot = join(root, 'assets');
  let store = new AssetStore({ root: assetRoot });
  let asset;
  try {
    asset = store.registerFile({ sourcePath: source, mediaType: 'image/png', registeredAt: t0 });
    const casPath = store.getPath(asset);
    writeFileSync(source, Buffer.from('mutated original'));
    assert.deepEqual(readFileSync(casPath), original);
    assert.equal(store.verifyAsset(asset), true);

    writeFileSync(casPath, Buffer.from('tampered cas'));
    assert.throws(() => store.verifyAsset(asset), /asset_bytes_mismatch/);
  } finally {
    store.close();
  }
  store = new AssetStore({ root: assetRoot });
  try {
    assert.throws(() => store.getAsset(asset.assetId), /asset_bytes_mismatch/);
  } finally {
    store.close();
  }
});

test('rejects a conflicting pre-existing CAS object without creating metadata authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-cas-race-'));
  const source = join(root, 'source.png');
  await writeSubject(source);
  const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
  const assetRoot = join(root, 'assets');
  const store = new AssetStore({ root: assetRoot });
  try {
    const objectDir = join(assetRoot, 'objects', digest.slice(0, 2));
    mkdirSync(objectDir, { recursive: true });
    writeFileSync(join(objectDir, digest), Buffer.from('conflicting object'));
    assert.throws(() => store.registerFile({
      sourcePath: source,
      mediaType: 'image/png',
      registeredAt: t0,
    }), /asset_store_object_hash_mismatch/);
    assert.throws(() => store.getAsset(`asset:sha256:${digest}`), /asset_not_found/);
  } finally {
    store.close();
  }
});

test('persists derived asset lineage across reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-lineage-reopen-'));
  const parentPath = await writeSubject(join(root, 'parent.png'));
  const childPath = await writeSubject(join(root, 'child.png'), { width: 8, height: 8 });
  const assetRoot = join(root, 'assets');
  let store = new AssetStore({ root: assetRoot });
  const parent = store.registerFile({ sourcePath: parentPath, mediaType: 'image/png', registeredAt: t0 });
  const child = store.registerDerivedFile({
    sourcePath: childPath,
    mediaType: 'image/png',
    registeredAt: t1,
    parentAssetIds: [parent.assetId],
    executionId: 'execution:lineage:reopen',
    lineageEventPrefix: 'lineage:reopen',
  });
  const attacker = new DatabaseSync(join(assetRoot, 'asset-index.sqlite3'));
  try {
    assert.equal(Number(attacker.prepare('PRAGMA recursive_triggers').get().recursive_triggers), 0);
    assert.throws(() => attacker.exec(`
      INSERT OR REPLACE INTO asset_lineage (
        event_id, child_asset_id, parent_asset_id, execution_id, created_at
      ) SELECT 'lineage:attacker:alternate-key', child_asset_id, parent_asset_id,
        execution_id, created_at FROM asset_lineage LIMIT 1
    `), /append_only_replace_forbidden/);
  } finally {
    attacker.close();
  }
  store.close();
  store = new AssetStore({ root: assetRoot });
  try {
    assert.equal(store.getAsset(child.assetId).sha256, child.sha256);
    assert.deepEqual(JSON.parse(JSON.stringify(store.listLineage(child.assetId))), [{
      eventId: 'lineage:reopen:1',
      childAssetId: child.assetId,
      parentAssetId: parent.assetId,
      executionId: 'execution:lineage:reopen',
      createdAt: t1,
    }]);
  } finally {
    store.close();
  }
});

test('rejects source raster metadata that disagrees with the ArtDocument declaration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-source-metadata-'));
  const source = await writeSubject(join(root, 'source.png'));
  const assetStore = new AssetStore({ root: join(root, 'assets') });
  const documentStore = new ArtDocumentStore({
    path: join(root, 'art.sqlite3'),
    assetStore,
  });
  try {
    documentStore.registerProject(projectRecord());
    const bridge = new WorkbenchExecutionBridge({
      assetStore,
      documentStore,
      operatorStore: {},
      targetResolver: {},
      providers: [],
      manifests: [],
      stagingRoot: join(root, 'staging'),
    });
    await assert.rejects(() => bridge.createDocumentFromSource({
      document: { ...documentRecord(), canvasExtent: { width: 8, height: 8 } },
      sourcePath: source,
      mediaType: 'image/png',
      sourceVersionId: 'version:metadata:mismatch',
      assetBindingId: 'binding:metadata:mismatch',
      currentEventId: 'current:metadata:mismatch',
      actor: human,
      occurredAt: t0,
    }), /art_source_raster_declaration_mismatch/);
    assert.throws(
      () => documentStore.getDocument('document:synthetic:v02'),
      /art_document_not_found/,
    );
  } finally {
    documentStore.close();
    assetStore.close();
  }
});

test('persists and resolves document, layer, mask, selection, region, structure, and field identities', async () => {
  const maskId = 'mask:synthetic:subject';
  const { root, assetStore, documentStore } = await setup({
    buildComponents: ({ asset, document, versionId }) => ({
      masks: [{
        schema: 'eve-atelier-art-mask/v1',
        maskId,
        documentId: document.documentId,
        versionId,
        maskType: 'SEMANTIC_REGION',
        assetRef: asset,
        semanticTarget: 'subject',
        createdAt: t0,
      }],
      selections: [{
        schema: 'eve-atelier-art-selection/v1',
        selectionId: 'selection:synthetic:subject',
        documentId: document.documentId,
        versionId,
        representation: { kind: 'MASK', assetRef: asset, geometryRef: null, revision: 1 },
        semanticLabel: 'subject selection',
        createdAt: t0,
      }],
      layers: [{
        schema: 'eve-atelier-art-layer/v1',
        layerId: 'layer:synthetic:base',
        documentId: document.documentId,
        versionId,
        name: 'Base',
        layerType: 'RASTER',
        order: 0,
        visibility: true,
        opacity: 1,
        blendMode: 'over',
        parentLayerId: null,
        assetRef: asset,
        maskIds: [maskId],
        createdAt: t0,
      }],
      regions: [{
        schema: 'eve-atelier-art-region/v1',
        regionId: 'region:synthetic:subject',
        documentId: document.documentId,
        versionId,
        regionType: 'SEMANTIC',
        semanticLabel: 'subject',
        representation: { kind: 'MASK', refId: maskId, revision: 1 },
        confidence: 1,
        createdAt: t0,
      }, {
        schema: 'eve-atelier-art-region/v1',
        regionId: 'region:synthetic:geometry-only',
        documentId: document.documentId,
        versionId,
        regionType: 'SEMANTIC',
        semanticLabel: 'geometry only',
        representation: { kind: 'GEOMETRY', refId: 'geometry:synthetic:1', revision: 1 },
        confidence: 0.8,
        createdAt: t0,
      }, {
        schema: 'eve-atelier-art-region/v1',
        regionId: 'region:synthetic:unresolved',
        documentId: document.documentId,
        versionId,
        regionType: 'SEMANTIC',
        semanticLabel: 'unresolved',
        representation: { kind: 'UNRESOLVED', refId: null, revision: 0 },
        confidence: 0,
        createdAt: t0,
      }],
      structureBindings: [{
        schema: 'eve-atelier-art-structure-binding/v1',
        structureId: 'structure:synthetic:pose',
        documentId: document.documentId,
        versionId,
        structureType: 'POSE_GRAPH',
        providerResourceRef: 'resource:synthetic:pose',
        revision: 1,
        createdAt: t0,
      }],
      fieldBindings: [{
        schema: 'eve-atelier-art-field-binding/v1',
        fieldBindingId: 'field:synthetic:normal',
        documentId: document.documentId,
        versionId,
        fieldType: 'NORMAL',
        providerRef: {
          providerId: 'provider:synthetic',
          providerVersion: '1.0.0',
          resourceId: 'resource:synthetic:normal',
        },
        derivedFromAsset: asset,
        revision: 1,
        confidence: 0.7,
        createdAt: t0,
      }],
    }),
  });
  const snapshot = documentStore.getDocumentSnapshot('document:synthetic:v02');
  const asset = snapshot.currentVersion.primaryAsset;

  const resolver = new ArtTargetResolver({ store: documentStore, assetStore });
  const cases = [
    ['LAYER', 'layer:synthetic:base'],
    ['MASK', 'mask:synthetic:subject'],
    ['SELECTION', 'selection:synthetic:subject'],
    ['REGION', 'region:synthetic:subject'],
    ['STRUCTURE', 'structure:synthetic:pose'],
    ['FIELD', 'field:synthetic:normal'],
  ];
  for (const [targetKind, componentId] of cases) {
    const resolved = resolver.resolve(sourceTarget(snapshot, {
      targetId: `target:${targetKind.toLowerCase()}`,
      targetKind,
      componentId,
    }));
    assert.equal(resolved.component.documentId, snapshot.document.documentId);
    assert.equal(resolved.component.versionId, snapshot.currentVersion.versionId);
  }
  const region = resolver.resolve(sourceTarget(snapshot, {
    targetId: 'target:region:mask',
    targetKind: 'REGION',
    componentId: 'region:synthetic:subject',
  }));
  assert.equal(resolver.pixelMask(region).asset.assetId, asset.assetId);
  const geometry = resolver.resolve(sourceTarget(snapshot, {
    targetId: 'target:region:geometry',
    targetKind: 'REGION',
    componentId: 'region:synthetic:geometry-only',
  }));
  assert.throws(() => resolver.pixelMask(geometry), /art_region_not_pixel_mask/);
  const unresolved = resolver.resolve(sourceTarget(snapshot, {
    targetId: 'target:region:unresolved',
    targetKind: 'REGION',
    componentId: 'region:synthetic:unresolved',
  }));
  assert.throws(() => resolver.pixelMask(unresolved), /art_region_not_pixel_mask/);
  assert.throws(() => documentStore.appendMask({
    ...documentStore.getMask(maskId),
    maskId: 'mask:synthetic:late',
  }), /art_version_graph_sealed/);

  documentStore.close();
  const reopened = new ArtDocumentStore({
    path: join(root, 'art.sqlite3'),
    assetStore,
  });
  try {
    assert.equal(reopened.getLayer('layer:synthetic:base').maskIds[0], maskId);
    assert.equal(reopened.getSelection('selection:synthetic:subject').representation.revision, 1);
    assert.equal(reopened.getRegion('region:synthetic:subject').representation.kind, 'MASK');
    assert.equal(reopened.getStructureBinding('structure:synthetic:pose').revision, 1);
    assert.equal(reopened.getFieldBinding('field:synthetic:normal').revision, 1);
  } finally {
    reopened.close();
    assetStore.close();
  }
});

test('stores durable evaluation and review evidence before append-only promotion', async () => {
  const { root, assetStore, documentStore } = await setup();
  assert.equal(typeof documentStore.appendVersion, 'undefined');
  assert.equal(typeof documentStore.appendAssetBinding, 'undefined');
  assert.equal(typeof documentStore.appendExecutionReceipt, 'undefined');
  const snapshot = documentStore.getDocumentSnapshot('document:synthetic:v02');
  const providerReceipt = {
    schema: 'eve-atelier-operator-execution-receipt/v1',
    executionId: 'execution:synthetic:candidate',
    operationId: 'operation:synthetic:candidate',
    packRef: { packId: 'operator-pack:synthetic', version: '1.0.0', digest: 'a'.repeat(64) },
    operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
    target: { kind: 'art.document_version', id: snapshot.currentVersion.versionId },
    expectedRevision: snapshot.documentRevision,
    revisionValidation: { status: 'VERIFIED', evidenceRef: 'evidence:synthetic:revision' },
    providerRef: { providerId: 'provider:synthetic', providerVersion: '1.0.0' },
    inputArtifacts: [{
      artifactId: snapshot.currentVersion.primaryAsset.assetId,
      sha256: snapshot.currentVersion.primaryAsset.sha256,
    }],
    outputArtifacts: [{
      artifactId: 'artifact:pending:synthetic',
      sha256: snapshot.currentVersion.primaryAsset.sha256,
    }],
    startedAt: t1,
    finishedAt: t1,
    status: 'completed',
    reproducibility: 'exact',
    metadata: {},
  };
  const receipt = {
    schema: 'eve-atelier-workbench-execution-receipt/v1',
    executionId: providerReceipt.executionId,
    operationId: providerReceipt.operationId,
    providerReceipt,
    inputAssets: [snapshot.currentVersion.primaryAsset],
    outputAsset: snapshot.currentVersion.primaryAsset,
    status: 'completed',
    recordedAt: t1,
  };
  const version = {
    schema: 'eve-atelier-art-document-version/v1',
    versionId: 'version:synthetic:v1',
    documentId: snapshot.document.documentId,
    parentVersionIds: [snapshot.currentVersion.versionId],
    primaryAsset: snapshot.currentVersion.primaryAsset,
    primaryAssetStatus: 'CURRENT_RENDER',
    canvasExtent: structuredClone(snapshot.currentVersion.canvasExtent),
    colorSpace: snapshot.currentVersion.colorSpace,
    createdByExecutionId: receipt.executionId,
    createdAt: t1,
    kind: 'CANDIDATE',
  };
  const candidateGraph = {
    receipt,
    recordedAt: t1,
    version,
    assetBinding: {
      schema: 'eve-atelier-art-asset-binding/v1',
      bindingId: 'binding:synthetic:v1:primary',
      documentId: version.documentId,
      versionId: version.versionId,
      assetRef: version.primaryAsset,
      assetRole: 'PRIMARY',
      target: { kind: 'DOCUMENT_VERSION', id: version.versionId },
      createdAt: t1,
    },
    expectedState: {
      documentId: version.documentId,
      parentVersionId: snapshot.currentVersion.versionId,
      inputAsset: snapshot.currentVersion.primaryAsset,
      outputAsset: snapshot.currentVersion.primaryAsset,
      expectedCurrentVersionId: snapshot.currentVersion.versionId,
      expectedDocumentRevision: snapshot.documentRevision,
      targetKind: 'DOCUMENT_VERSION',
      componentId: null,
      componentRevision: 0,
      componentGraphDigest: snapshot.componentGraph.componentDigest,
    },
    componentReplacement: null,
    componentPolicy: 'COPY_FORWARD',
  };
  for (const [name, mutate] of [
    ['failed receipt', value => { value.receipt.status = 'failed'; }],
    ['unrelated output', value => {
      value.receipt.providerReceipt.outputArtifacts[0].sha256 = '0'.repeat(64);
    }],
  ]) {
    const invalid = structuredClone(candidateGraph);
    invalid.version.versionId = `version:invalid:${name}`;
    invalid.assetBinding.versionId = invalid.version.versionId;
    invalid.assetBinding.bindingId = `binding:invalid:${name}`;
    invalid.assetBinding.target.id = invalid.version.versionId;
    mutate(invalid);
    assert.throws(
      () => documentStore.appendCandidateGraph(invalid),
      /art_candidate_receipt_asset_mismatch/,
      name,
    );
    assert.throws(
      () => documentStore.getVersion(invalid.version.versionId),
      /art_document_version_not_found/,
    );
  }
  documentStore.appendCandidateGraph(candidateGraph);
  const evaluation = documentStore.recordEvaluation({
    schema: 'eve-atelier-art-evaluation/v1',
    evaluationId: 'evaluation:synthetic:v1',
    documentId: version.documentId,
    versionId: version.versionId,
    verdict: 'ACCEPT',
    evaluator: { kind: 'DETERMINISTIC', id: 'validator:synthetic', version: '1.0.0' },
    measurements: { syntheticControl: true },
    evidenceRefs: ['evidence:synthetic:validation'],
    warnings: [],
    evaluatedAt: t2,
  });
  assert.throws(() => documentStore.promoteCandidate({
    schema: 'eve-atelier-art-current-event/v1',
    eventId: 'current:synthetic:missing-review',
    documentId: version.documentId,
    fromVersionId: snapshot.currentVersion.versionId,
    toVersionId: version.versionId,
    reason: 'PROMOTION',
    evaluationId: evaluation.evaluationId,
    reviewId: null,
    evidenceRefs: ['evidence:synthetic:promotion'],
    actor: human,
    occurredAt: t3,
  }), /art_promotion_human_review_required/);
  const review = documentStore.recordHumanReview({
    schema: 'eve-atelier-art-human-review/v1',
    reviewId: 'review:synthetic:v1',
    documentId: version.documentId,
    versionId: version.versionId,
    reviewer: human,
    disposition: 'APPROVE',
    reason: 'Synthetic acceptance control.',
    evidenceRefs: ['evidence:synthetic:human'],
    reviewedAt: t2,
  });
  documentStore.promoteCandidate({
    schema: 'eve-atelier-art-current-event/v1',
    eventId: 'current:synthetic:promote-v1',
    documentId: version.documentId,
    fromVersionId: snapshot.currentVersion.versionId,
    toVersionId: version.versionId,
    reason: 'PROMOTION',
    evaluationId: evaluation.evaluationId,
    reviewId: review.reviewId,
    evidenceRefs: ['evidence:synthetic:promotion'],
    actor: human,
    occurredAt: t3,
  });
  assert.equal(documentStore.getDocumentSnapshot(version.documentId).currentVersion.versionId, version.versionId);
  documentStore.close();

  const reopened = new ArtDocumentStore({ path: join(root, 'art.sqlite3'), assetStore });
  try {
    assert.equal(reopened.getEvaluation(evaluation.evaluationId).versionId, version.versionId);
    assert.equal(reopened.getHumanReview(review.reviewId).versionId, version.versionId);
    assert.equal(reopened.getDocumentSnapshot(version.documentId).currentVersion.versionId, version.versionId);
  } finally {
    reopened.close();
    assetStore.close();
  }
});

test('database triggers reject update, delete, and replace of immutable art history', async () => {
  const { root, assetStore, documentStore } = await setup();
  const snapshot = documentStore.getDocumentSnapshot('document:synthetic:v02');
  documentStore.prepareProjectionAttempt({
    schema: 'eve-atelier-art-projection-attempt/v1',
    attemptId: 'projection-attempt:trigger-control',
    projectionEventId: 'projection:trigger-control',
    documentId: snapshot.document.documentId,
    versionId: snapshot.currentVersion.versionId,
    mode: 'CREATE',
    idempotencyKey: 'idempotency:trigger-control',
    providerResourceId: 'artifact:trigger-control',
    preparedAt: t1,
  });
  documentStore.recordProjectionEvent({
    schema: 'eve-atelier-art-projection-event/v1',
    projectionEventId: 'projection:trigger-control',
    documentId: snapshot.document.documentId,
    versionId: snapshot.currentVersion.versionId,
    status: 'VERIFIED',
    idempotencyKey: 'idempotency:trigger-control',
    providerResourceId: 'artifact:trigger-control',
    evidenceRefs: ['evidence:trigger-control'],
    recordedAt: t1,
  });
  const attacker = new DatabaseSync(join(root, 'art.sqlite3'));
  const assetAttacker = new DatabaseSync(join(root, 'assets', 'asset-index.sqlite3'));
  try {
    assert.equal(Number(attacker.prepare('PRAGMA recursive_triggers').get().recursive_triggers), 0);
    assert.equal(Number(assetAttacker.prepare('PRAGMA recursive_triggers').get().recursive_triggers), 0);
    const immutableTables = [
      'art_projects', 'art_documents', 'art_execution_receipts', 'art_versions',
      'art_layers', 'art_masks', 'art_selections', 'art_regions',
      'art_structure_bindings', 'art_field_bindings', 'art_asset_bindings',
      'art_evaluations', 'art_human_reviews', 'art_current_events',
      'art_projection_events', 'art_component_lineage',
      'art_projection_attempts', 'art_version_graph_seals',
    ];
    const sealedGraphTables = new Set([
      'art_layers', 'art_masks', 'art_selections', 'art_regions',
      'art_structure_bindings', 'art_field_bindings', 'art_asset_bindings',
      'art_component_lineage',
    ]);
    for (const table of immutableTables) {
      const triggerCount = attacker.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'trigger' AND tbl_name = ?
      `).get(table).count;
      assert.equal(Number(triggerCount), sealedGraphTables.has(table) ? 4 : 3, table);
    }
    for (const statement of [
      "UPDATE art_projects SET record_json = '{}'",
      'DELETE FROM art_documents',
      'INSERT OR REPLACE INTO art_versions SELECT * FROM art_versions',
      'INSERT OR REPLACE INTO art_asset_bindings SELECT * FROM art_asset_bindings',
      'INSERT OR REPLACE INTO art_current_events SELECT * FROM art_current_events',
      `INSERT OR REPLACE INTO art_current_events (
        event_sequence, event_id, document_id, from_version_id, to_version_id,
        reason, evaluation_id, review_id, record_json
      ) SELECT event_sequence, 'current:attacker:alternate-key', document_id,
        from_version_id, to_version_id, reason, evaluation_id, review_id, '{}'
        FROM art_current_events LIMIT 1`,
      `INSERT OR REPLACE INTO art_projection_events (
        projection_event_id, document_id, version_id, projection_status,
        idempotency_key, record_json
      ) SELECT 'projection:attacker:alternate-key', document_id, version_id,
        projection_status, idempotency_key, '{}' FROM art_projection_events LIMIT 1`,
      `INSERT OR REPLACE INTO art_projection_attempts (
        attempt_id, projection_event_id, document_id, version_id, mode,
        idempotency_key, provider_resource_id, record_json
      ) SELECT 'projection-attempt:attacker:alternate-key', projection_event_id,
        document_id, version_id, mode, idempotency_key, provider_resource_id, '{}'
        FROM art_projection_attempts LIMIT 1`,
    ]) {
      assert.throws(
        () => attacker.exec(statement),
        /(?:append_only_(?:update|delete|replace)_forbidden|sealed_version_insert_forbidden)/,
        statement,
      );
    }
    assert.throws(() => attacker.exec(`
      INSERT INTO art_layers (
        layer_id, document_id, version_id, record_json
      ) VALUES (
        'layer:attacker:late', 'document:synthetic:v02',
        'version:synthetic:v0', '{}'
      )
    `), /sealed_version_insert_forbidden/);
    attacker.exec(`
      INSERT INTO art_versions (
        version_id, document_id, version_kind, execution_id, record_json
      ) VALUES
        ('version:unsealed:from', 'document:synthetic:v02', 'CANDIDATE', NULL, '{}'),
        ('version:unsealed:to', 'document:synthetic:v02', 'CANDIDATE', NULL, '{}');
      INSERT INTO art_component_lineage (
        lineage_id, component_kind, child_component_id, parent_component_id,
        from_version_id, to_version_id, record_json
      ) VALUES (
        'lineage:trigger:first', 'LAYER', 'layer:child', 'layer:parent',
        'version:unsealed:from', 'version:unsealed:to', '{}'
      )
    `);
    assert.throws(() => attacker.exec(`
      INSERT OR REPLACE INTO art_component_lineage (
        lineage_id, component_kind, child_component_id, parent_component_id,
        from_version_id, to_version_id, record_json
      ) VALUES (
        'lineage:trigger:alternate', 'LAYER', 'layer:child', 'layer:parent',
        'version:unsealed:from', 'version:unsealed:to', '{}'
      )
    `), /append_only_replace_forbidden/);
    assert.throws(() => assetAttacker.exec(`
      INSERT OR REPLACE INTO assets (
        asset_id, sha256, media_type, byte_size, relative_key, registered_at
      ) SELECT 'asset:attacker:alternate-key', sha256, media_type, byte_size,
        'objects/attacker', registered_at FROM assets LIMIT 1
    `), /append_only_replace_forbidden/);
    assert.throws(() => assetAttacker.exec(`
      INSERT OR REPLACE INTO assets (
        rowid, asset_id, sha256, media_type, byte_size, relative_key, registered_at
      ) SELECT rowid, 'asset:attacker:rowid',
        '0000000000000000000000000000000000000000000000000000000000000000',
        media_type, byte_size, 'objects/rowid-attacker', registered_at
        FROM assets LIMIT 1
    `), /append_only_replace_forbidden/);
    assert.throws(() => attacker.exec(`
      INSERT OR REPLACE INTO art_projects (rowid, project_id, record_json)
      SELECT rowid, 'project:attacker:rowid', '{}' FROM art_projects LIMIT 1
    `), /append_only_replace_forbidden/);
  } finally {
    assetAttacker.close();
    attacker.close();
    documentStore.close();
    assetStore.close();
  }
});
