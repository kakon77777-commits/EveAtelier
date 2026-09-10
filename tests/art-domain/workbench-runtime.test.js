import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetStore } from '../../src/art-domain/asset-store.js';
import { ArtDocumentStore } from '../../src/art-domain/store.js';
import { ArtTargetResolver } from '../../src/art-domain/target-resolver.js';
import { WorkbenchExecutionBridge } from '../../src/art-domain/workbench-runtime.js';
import { exportCurrentOpenRaster } from '../../src/art-domain/interchange.js';
import { OperatorRegistryStore } from '../../src/operator-runtime/registry-store.js';
import { SharpRasterProvider } from '../../src/providers/sharp-raster-provider.js';
import { validateBackgroundRemoval } from '../../src/evaluation.js';
import { MrmicClient, buildArtResourcePortal } from '../../src/mrmic-client.js';
import {
  documentRecord,
  projectRecord,
  sourceTarget,
  writeOverlay,
  writeSubject,
} from './helpers.js';

const human = { kind: 'HUMAN', id: 'human:v02-owner' };
const initialAt = '2026-09-11T01:00:00Z';
const verifiedAt = '2026-09-11T01:00:01Z';

const mrmicCapabilities = {
  schema: 'mrmic-capabilities/v1',
  mrmicVersion: '0.14.0',
  canvasSchemaVersion: '1',
  mcpProtocolProfile: { protocolVersion: '2025-11-25', profile: 'stateful_subset' },
  projectionModes: ['snapshot'],
  authModes: ['legacy_local'],
  resourcePortal: { supported: true, schemaVersion: 'native_resource_portal_v1' },
  runtimePresence: {
    supported: true,
    schemaVersion: 'ephemeral_runtime_presence_v1',
    durable: false,
  },
  livePortalHost: { supported: true, stateVersion: 'live_portal_host_v1' },
};

async function withServer(handler, action) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await action(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function clock() {
  let milliseconds = Date.parse('2026-09-11T01:01:00Z');
  return () => new Date(milliseconds += 1000).toISOString();
}

async function operatorPack() {
  return JSON.parse(await readFile(new URL(
    '../../fixtures/operator_runtime/v02-deterministic-pack.example.json',
    import.meta.url,
  ), 'utf8'));
}

function activatePack(store, pack) {
  const registered = store.registerPack({ pack, proposer: human, registeredAt: initialAt });
  const ref = {
    packId: registered.packId,
    version: registered.version,
    digest: registered.digest,
  };
  const transition = (eventId, fromStatus, toStatus, occurredAt) => store.appendLifecycleEvent({
    schema: 'eve-atelier-operator-lifecycle-event/v1',
    eventId,
    packRef: structuredClone(ref),
    fromStatus,
    toStatus,
    evidenceRefs: [`evidence:${eventId}`],
    actor: human,
    createdAt: occurredAt,
  });
  transition('lifecycle:v02:experimental', 'DRAFT', 'EXPERIMENTAL_UNCALIBRATED', '2026-09-11T01:00:01Z');
  transition('lifecycle:v02:calibrated', 'EXPERIMENTAL_UNCALIBRATED', 'CALIBRATED', '2026-09-11T01:00:02Z');
  transition('lifecycle:v02:active', 'CALIBRATED', 'ACTIVE', '2026-09-11T01:00:03Z');
  return ref;
}

function providerPolicy(capability, overrides = {}) {
  return {
    allowedPrivacy: ['LOCAL'],
    requiredSupports: [],
    allowedLicenseSpdx: [capability.license.spdx],
    allowedLicenseBoundaries: [capability.license.boundary],
    verifiedAtOrAfter: '2026-09-11T00:00:00Z',
    ...overrides,
  };
}

async function setup({
  provider: suppliedProvider,
  mrmicClient = null,
  buildComponents = null,
  mutatePack = null,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-runtime-'));
  const source = await writeSubject(join(root, 'source.png'));
  const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
  const assetStore = new AssetStore({ root: join(root, 'assets') });
  const sourceAsset = assetStore.registerFile({
    sourcePath: source,
    mediaType: 'image/png',
    registeredAt: initialAt,
  });
  const documentStore = new ArtDocumentStore({
    path: join(root, 'art.sqlite3'),
    assetStore,
  });
  const operatorStore = new OperatorRegistryStore({ path: join(root, 'operators.sqlite3') });
  const pack = await operatorPack();
  if (mutatePack !== null) mutatePack(pack);
  const packRef = activatePack(operatorStore, pack);
  const provider = suppliedProvider ?? new SharpRasterProvider({ now: () => verifiedAt });
  const capability = await provider.capability();
  const resolver = new ArtTargetResolver({ store: documentStore, assetStore });
  const bridge = new WorkbenchExecutionBridge({
    assetStore,
    documentStore,
    operatorStore,
    targetResolver: resolver,
    providers: [provider],
    manifests: [capability],
    stagingRoot: join(root, 'staging'),
    mrmicClient,
  });
  bridge.createProject(projectRecord(initialAt));
  const document = { ...documentRecord(initialAt), promotionPolicy: 'automatic_deterministic' };
  await bridge.createDocumentFromSource({
    document,
    sourcePath: source,
    mediaType: 'image/png',
    sourceVersionId: 'version:v02:source',
    assetBindingId: 'binding:v02:source',
    currentEventId: 'current:v02:initial',
    actor: human,
    occurredAt: initialAt,
    components: buildComponents === null
      ? {}
      : buildComponents({ asset: sourceAsset, document, versionId: 'version:v02:source' }),
  });
  return {
    root, source, sourceHash, assetStore, documentStore, operatorStore,
    packRef, provider, capability, resolver, bridge,
  };
}

function close(context) {
  context.operatorStore.close();
  context.documentStore.close();
  context.assetStore.close();
}

test('runs operator registry to sharp to assets to document candidates and promotion', async () => {
  const context = await setup();
  const now = clock();
  try {
    const sourceSnapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    const maskResult = await context.bridge.executeOperator({
      operationId: 'operation:v02:create-mask',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.create_mask', version: '1.0.0' },
      target: sourceTarget(sourceSnapshot),
      params: { background: [255, 255, 255], tolerance: 8 },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png',
      outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    });
    const alphaResult = await context.bridge.executeOperator({
      operationId: 'operation:v02:create-alpha',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.create_alpha', version: '1.0.0' },
      target: sourceTarget(sourceSnapshot),
      params: { mask: maskResult.asset.assetId },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png',
      outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:alpha',
        assetBindingId: 'binding:v02:alpha',
      },
      now,
    });
    assert.deepEqual(
      new Set(context.assetStore.listLineage(alphaResult.asset.assetId)
        .map(item => item.parentAssetId)),
      new Set([sourceSnapshot.currentVersion.primaryAsset.assetId, maskResult.asset.assetId]),
    );
    assert.equal(context.documentStore.listMasks(
      sourceSnapshot.document.documentId,
      alphaResult.candidate.version.versionId,
    ).length, 0);
    assert.equal(
      context.documentStore.getDocumentSnapshot(sourceSnapshot.document.documentId)
        .currentVersion.versionId,
      sourceSnapshot.currentVersion.versionId,
    );
    const alphaTarget = sourceTarget(sourceSnapshot, {
      targetId: 'target:v02:alpha',
      targetKind: 'DOCUMENT_VERSION',
      versionId: alphaResult.candidate.version.versionId,
      componentId: null,
    });
    const finalResult = await context.bridge.executeOperator({
      operationId: 'operation:v02:edge-cleanup',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.edge_cleanup', version: '1.0.0' },
      target: alphaTarget,
      params: { radius: 1, mask: maskResult.asset.assetId },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png',
      outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:clean',
        assetBindingId: 'binding:v02:clean',
      },
      now,
    });
    const validation = validateBackgroundRemoval(context.assetStore.getPath(finalResult.asset));
    assert.equal(validation.verdict, 'ACCEPT');
    context.bridge.recordEvaluation({
      schema: 'eve-atelier-art-evaluation/v1',
      evaluationId: 'evaluation:v02:ai-self-accept',
      documentId: sourceSnapshot.document.documentId,
      versionId: finalResult.candidate.version.versionId,
      verdict: 'ACCEPT',
      evaluator: { kind: 'AI', id: 'ai:self-evaluator', version: '1.0.0' },
      measurements: { conditionalOpinion: 'pass' },
      evidenceRefs: ['evidence:v02:ai-opinion'],
      warnings: [],
      evaluatedAt: now(),
    });
    assert.throws(() => context.bridge.promoteCandidate({
      documentId: sourceSnapshot.document.documentId,
      versionId: finalResult.candidate.version.versionId,
      evaluationId: 'evaluation:v02:ai-self-accept',
      eventId: 'current:v02:reject-ai-self-accept',
      actor: { kind: 'AI', id: 'ai:self-evaluator' },
      evidenceRefs: ['evidence:v02:ai-opinion'],
      expectedCurrentVersionId: sourceSnapshot.currentVersion.versionId,
      occurredAt: now(),
    }), /art_automatic_promotion_deterministic_evaluator_required/);
    context.bridge.recordEvaluation({
      schema: 'eve-atelier-art-evaluation/v1',
      evaluationId: 'evaluation:v02:clean',
      documentId: sourceSnapshot.document.documentId,
      versionId: finalResult.candidate.version.versionId,
      verdict: validation.verdict,
      evaluator: { kind: 'DETERMINISTIC', id: 'validator:alpha', version: '1.0.0' },
      measurements: {
        width: validation.width,
        height: validation.height,
        rgbHash: validation.rgbHash,
        alphaHash: validation.alphaHash,
        transparentPixels: validation.transparentPixels,
        opaquePixels: validation.opaquePixels,
        partialAlphaPixels: validation.partialAlphaPixels,
        sourceSha256: context.sourceHash,
        outputSha256: finalResult.asset.sha256,
      },
      evidenceRefs: ['evidence:v02:alpha-and-edge'],
      warnings: [],
      evaluatedAt: now(),
    });
    context.bridge.promoteCandidate({
      documentId: sourceSnapshot.document.documentId,
      versionId: finalResult.candidate.version.versionId,
      evaluationId: 'evaluation:v02:clean',
      eventId: 'current:v02:promote-clean',
      actor: human,
      evidenceRefs: ['evidence:v02:promotion'],
      expectedCurrentVersionId: sourceSnapshot.currentVersion.versionId,
      occurredAt: now(),
    });
    const finalSnapshot = context.documentStore.getDocumentSnapshot(sourceSnapshot.document.documentId);
    assert.equal(finalSnapshot.currentVersion.versionId, 'version:v02:clean');
    assert.deepEqual(finalSnapshot.currentVersion.parentVersionIds, ['version:v02:alpha']);
    assert.equal(context.assetStore.listLineage(finalResult.asset.assetId)[0].parentAssetId,
      alphaResult.asset.assetId);
    assert.equal(createHash('sha256').update(readFileSync(context.source)).digest('hex'), context.sourceHash);
    assert.equal(context.documentStore.listMasks(
      sourceSnapshot.document.documentId,
      finalResult.candidate.version.versionId,
    ).length, 0);
    assert.equal(context.documentStore.listRegions(
      sourceSnapshot.document.documentId,
      finalResult.candidate.version.versionId,
    ).length, 0);
    assert.equal(finalResult.candidate.graphSeal.policy, 'COPY_FORWARD');
    context.bridge.restoreVersion({
      documentId: sourceSnapshot.document.documentId,
      versionId: sourceSnapshot.currentVersion.versionId,
      eventId: 'current:v02:restore-source',
      actor: human,
      evidenceRefs: ['evidence:v02:restore'],
      expectedCurrentVersionId: finalResult.candidate.version.versionId,
      occurredAt: now(),
    });
    assert.equal(context.documentStore.getDocumentSnapshot(sourceSnapshot.document.documentId)
      .currentVersion.versionId, sourceSnapshot.currentVersion.versionId);
  } finally {
    close(context);
  }
});

test('executes a layer target and carries the untouched component graph across reopen', async () => {
  const context = await setup({
    buildComponents: ({ asset, document, versionId }) => ({
      layers: [{
        schema: 'eve-atelier-art-layer/v1',
        layerId: 'layer:v02:group',
        documentId: document.documentId,
        versionId,
        name: 'Group',
        layerType: 'GROUP',
        order: 0,
        visibility: true,
        opacity: 1,
        blendMode: 'over',
        parentLayerId: null,
        assetRef: null,
        maskIds: [],
        createdAt: initialAt,
      }, {
        schema: 'eve-atelier-art-layer/v1',
        layerId: 'layer:v02:detail',
        documentId: document.documentId,
        versionId,
        name: 'Detail',
        layerType: 'RASTER',
        order: 1,
        visibility: true,
        opacity: 0.75,
        blendMode: 'multiply',
        parentLayerId: 'layer:v02:group',
        assetRef: asset,
        maskIds: [],
        createdAt: initialAt,
      }],
    }),
  });
  const now = clock();
  let closed = false;
  try {
    const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    const overlayPath = await writeOverlay(join(context.root, 'layer-input.png'), {
      width: 16,
      height: 16,
    });
    const layerAsset = context.assetStore.registerFile({
      sourcePath: overlayPath,
      mediaType: 'image/png',
      registeredAt: now(),
    });
    const maskResult = await context.bridge.executeOperator({
      operationId: 'operation:v02:layer-mask',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.create_mask', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { background: [255, 255, 255], tolerance: 8 },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    });
    const compositeResult = await context.bridge.executeOperator({
      operationId: 'operation:v02:layer-composite-lineage',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.composite.layer_composite', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: {
        overlay: layerAsset.assetId,
        mask: maskResult.asset.assetId,
        left: 2,
        top: 2,
        opacity: 0.5,
        blend: 'over',
      },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    });
    assert.deepEqual(
      new Set(context.assetStore.listLineage(compositeResult.asset.assetId)
        .map(item => item.parentAssetId)),
      new Set([
        snapshot.currentVersion.primaryAsset.assetId,
        layerAsset.assetId,
        maskResult.asset.assetId,
      ]),
    );
    const groupRender = await context.bridge.executeOperator({
      operationId: 'operation:v02:group-render',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.composite.layer_composite', version: '1.0.0' },
      target: sourceTarget(snapshot, {
        targetId: 'target:v02:group',
        targetKind: 'LAYER',
        componentId: 'layer:v02:group',
      }),
      params: {},
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png',
      outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    });
    assert.notEqual(groupRender.asset.sha256, snapshot.currentVersion.primaryAsset.sha256);
    const result = await context.bridge.executeOperator({
      operationId: 'operation:v02:layer-recolor',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.recolor', version: '1.0.0' },
      target: sourceTarget(snapshot, {
        targetId: 'target:v02:detail-layer',
        targetKind: 'LAYER',
        componentId: 'layer:v02:detail',
      }),
      params: { tint: [0.5, 1, 1] },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png',
      outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:layer-edit',
        assetBindingId: 'binding:v02:layer-edit',
      },
      now,
    });
    assert.equal(result.candidate.version.primaryAsset.assetId,
      snapshot.currentVersion.primaryAsset.assetId);
    const groupId = result.candidate.componentMap.LAYER['layer:v02:group'];
    const detailId = result.candidate.componentMap.LAYER['layer:v02:detail'];
    const detail = context.documentStore.getLayer(detailId);
    assert.equal(detail.assetRef.assetId, result.asset.assetId);
    assert.equal(detail.parentLayerId, groupId);
    assert.equal(context.documentStore.getLayer(groupId).layerType, 'GROUP');
    assert.equal(context.documentStore.listComponentLineage(result.candidate.version.versionId)
      .filter(item => item.componentKind === 'LAYER').length, 2);
    context.bridge.recordEvaluation({
      schema: 'eve-atelier-art-evaluation/v1',
      evaluationId: 'evaluation:v02:layer-edit',
      documentId: snapshot.document.documentId,
      versionId: result.candidate.version.versionId,
      verdict: 'ACCEPT',
      evaluator: { kind: 'DETERMINISTIC', id: 'validator:layer', version: '1.0.0' },
      measurements: { componentBytesVerified: true },
      evidenceRefs: ['evidence:v02:layer-edit'],
      warnings: [],
      evaluatedAt: now(),
    });
    assert.throws(() => context.bridge.promoteCandidate({
      documentId: snapshot.document.documentId,
      versionId: result.candidate.version.versionId,
      evaluationId: 'evaluation:v02:layer-edit',
      eventId: 'current:v02:reject-stale-preview',
      actor: human,
      evidenceRefs: ['evidence:v02:stale-preview'],
      expectedCurrentVersionId: snapshot.currentVersion.versionId,
      occurredAt: now(),
    }), /art_current_render_required/);
    assert.throws(() => context.bridge.restoreVersion({
      documentId: snapshot.document.documentId,
      versionId: result.candidate.version.versionId,
      eventId: 'current:v02:reject-stale-restore',
      actor: human,
      evidenceRefs: ['evidence:v02:stale-restore'],
      expectedCurrentVersionId: snapshot.currentVersion.versionId,
      occurredAt: now(),
    }), /art_current_render_required/);

    context.operatorStore.close();
    context.documentStore.close();
    context.assetStore.close();
    closed = true;
    const assets = new AssetStore({ root: join(context.root, 'assets') });
    const documents = new ArtDocumentStore({
      path: join(context.root, 'art.sqlite3'),
      assetStore: assets,
    });
    try {
      assert.equal(documents.getLayer(detailId).assetRef.assetId, result.asset.assetId);
      assert.equal(documents.getLayer(detailId).parentLayerId, groupId);
      assert.equal(documents.listLayers(snapshot.document.documentId, result.candidate.version.versionId)
        .length, 2);
    } finally {
      documents.close();
      assets.close();
    }
  } finally {
    if (!closed) close(context);
  }
});

test('invalidates stale spatial components after resize and rejects mismatched masks', async () => {
  const context = await setup({
    buildComponents: ({ asset, document, versionId }) => ({
      masks: [{
        schema: 'eve-atelier-art-mask/v1',
        maskId: 'mask:v02:pre-resize',
        documentId: document.documentId,
        versionId,
        maskType: 'SEMANTIC_REGION',
        assetRef: asset,
        semanticTarget: 'subject',
        createdAt: initialAt,
      }],
      layers: [{
        schema: 'eve-atelier-art-layer/v1',
        layerId: 'layer:v02:pre-resize',
        documentId: document.documentId,
        versionId,
        name: 'Pre-resize layer',
        layerType: 'RASTER',
        order: 0,
        visibility: true,
        opacity: 1,
        blendMode: 'over',
        parentLayerId: null,
        assetRef: asset,
        maskIds: ['mask:v02:pre-resize'],
        createdAt: initialAt,
      }],
      regions: [{
        schema: 'eve-atelier-art-region/v1',
        regionId: 'region:v02:pre-resize',
        documentId: document.documentId,
        versionId,
        regionType: 'SEMANTIC',
        semanticLabel: 'subject',
        representation: { kind: 'MASK', refId: 'mask:v02:pre-resize', revision: 1 },
        confidence: 1,
        createdAt: initialAt,
      }],
      structureBindings: [{
        schema: 'eve-atelier-art-structure-binding/v1',
        structureId: 'structure:v02:pre-resize',
        documentId: document.documentId,
        versionId,
        structureType: 'POSE_GRAPH',
        providerResourceRef: 'resource:v02:pose',
        revision: 1,
        createdAt: initialAt,
      }],
      fieldBindings: [{
        schema: 'eve-atelier-art-field-binding/v1',
        fieldBindingId: 'field:v02:pre-resize',
        documentId: document.documentId,
        versionId,
        fieldType: 'NORMAL',
        providerRef: {
          providerId: 'provider:synthetic',
          providerVersion: '1.0.0',
          resourceId: 'resource:v02:normal',
        },
        derivedFromAsset: asset,
        revision: 1,
        confidence: 1,
        createdAt: initialAt,
      }],
    }),
  });
  const now = clock();
  try {
    const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    const resized = await context.bridge.executeOperator({
      operationId: 'operation:v02:resize-invalidates-components',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { width: 8, height: 8, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:resized',
        assetBindingId: 'binding:v02:resized',
      },
      now,
    });
    assert.deepEqual(resized.candidate.version.canvasExtent, { width: 8, height: 8 });
    assert.equal(resized.candidate.graphSeal.policy, 'INVALIDATE_SPATIAL');
    for (const list of [
      'listMasks', 'listLayers', 'listRegions', 'listStructureBindings', 'listFieldBindings',
    ]) {
      assert.equal(context.documentStore[list](
        snapshot.document.documentId,
        resized.candidate.version.versionId,
      ).length, 0, list);
    }
    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:reject-old-mask-after-resize',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.create_alpha', version: '1.0.0' },
      target: sourceTarget(snapshot, {
        targetId: 'target:v02:resized',
        versionId: resized.candidate.version.versionId,
      }),
      params: { mask: snapshot.currentVersion.primaryAsset.assetId },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    }), /sharp_mask_extent_mismatch/);
  } finally {
    close(context);
  }
});

test('returns an operator-bounded fallback and blocks observation-only candidates', async () => {
  const real = new SharpRasterProvider({ now: () => verifiedAt });
  const failingProvider = {
    providerId: real.providerId,
    providerVersion: real.providerVersion,
    capability: () => real.capability(),
    async execute() {
      throw new Error('QUALITY_FAILURE:synthetic_control');
    },
  };
  const failed = await setup({ provider: failingProvider });
  try {
    const snapshot = failed.documentStore.getDocumentSnapshot('document:synthetic:v02');
    const result = await failed.bridge.executeOperatorWithFallback({
      operationId: 'operation:v02:fallback-repair',
      packRef: failed.packRef,
      operatorRef: { operatorId: 'visual.op.raster.recolor', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { tint: [1, 0.8, 0.8] },
      providerPolicy: providerPolicy(failed.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      fallbackContext: {
        alternativeProviderAvailable: false,
        localRepairAvailable: true,
      },
      now: clock(),
    });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.failure.failureClass, 'QUALITY_FAILURE');
    assert.equal(result.failure.decision, 'REPAIR');
    assert.deepEqual(result.failure.allowedDecisions, ['REPAIR', 'ASK_HUMAN']);
    assert.equal(result.failure.retryAuthorized, false);
  } finally {
    close(failed);
  }

  const observation = await setup({
    mutatePack: pack => {
      pack.families[0].variants.find(item => (
        item.operatorId === 'visual.op.raster.recolor'
      )).authority = 'OBSERVATION_ONLY';
    },
  });
  try {
    const snapshot = observation.documentStore.getDocumentSnapshot('document:synthetic:v02');
    await assert.rejects(() => observation.bridge.executeOperator({
      operationId: 'operation:v02:observation-candidate',
      packRef: observation.packRef,
      operatorRef: { operatorId: 'visual.op.raster.recolor', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { tint: [1, 1, 1] },
      providerPolicy: providerPolicy(observation.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:observation-forbidden',
        assetBindingId: 'binding:v02:observation-forbidden',
      },
      now: clock(),
    }), /workbench_observation_operator_commit_forbidden/);
    assert.throws(
      () => observation.documentStore.getVersion('version:v02:observation-forbidden'),
      /art_document_version_not_found/,
    );
  } finally {
    close(observation);
  }
});

test('rejects stale targets before provider access and during provider execution without a candidate', async () => {
  const real = new SharpRasterProvider({ now: () => verifiedAt });
  let calls = 0;
  const counted = {
    providerId: real.providerId,
    providerVersion: real.providerVersion,
    capability: () => real.capability(),
    execute: async value => {
      calls += 1;
      return real.execute(value);
    },
  };
  const context = await setup({
    provider: counted,
    buildComponents: ({ document, versionId }) => ({
      regions: [{
        schema: 'eve-atelier-art-region/v1',
        regionId: 'region:v02:geometry-only',
        documentId: document.documentId,
        versionId,
        regionType: 'SEMANTIC',
        semanticLabel: 'geometry-only region',
        representation: { kind: 'GEOMETRY', refId: 'geometry:v02:1', revision: 1 },
        confidence: 0.8,
        createdAt: initialAt,
      }, {
        schema: 'eve-atelier-art-region/v1',
        regionId: 'region:v02:unresolved',
        documentId: document.documentId,
        versionId,
        regionType: 'SEMANTIC',
        semanticLabel: 'unresolved region',
        representation: { kind: 'UNRESOLVED', refId: null, revision: 0 },
        confidence: 0,
        createdAt: initialAt,
      }],
    }),
  });
  const now = clock();
  try {
    const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:stale-before',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(snapshot, { expectedDocumentRevision: 99 }),
      params: { width: 8, height: 8, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'CANDIDATE_VERSION', versionId: 'version:stale', assetBindingId: 'binding:stale' },
      now,
    }), /art_target_stale_document_revision/);
    assert.equal(calls, 0);

    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:raw-mask-path',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.create_alpha', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { mask: context.source },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    }), /workbench_provider_asset_parameter_invalid:mask/);
    assert.equal(calls, 0);

    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:geometry-region',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.edge_cleanup', version: '1.0.0' },
      target: sourceTarget(snapshot, {
        targetKind: 'REGION',
        componentId: 'region:v02:geometry-only',
      }),
      params: { radius: 1 },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    }), /art_region_provider_representation_unavailable/);
    assert.equal(calls, 0);

    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:unresolved-region',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.edge_cleanup', version: '1.0.0' },
      target: sourceTarget(snapshot, {
        targetKind: 'REGION',
        componentId: 'region:v02:unresolved',
      }),
      params: { radius: 1 },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    }), /art_region_provider_representation_unavailable/);
    assert.equal(calls, 0);

    let reads = 0;
    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:stale-during',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(snapshot, { expectedCanvasRevision: 4 }),
      params: { width: 8, height: 8, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:stale-during',
        assetBindingId: 'binding:stale-during',
      },
      canvasRevisionReader: async () => {
        reads += 1;
        return reads < 3 ? 4 : 5;
      },
      now,
    }), /art_target_stale_canvas_revision/);
    assert.equal(calls, 1);
    assert.throws(
      () => context.documentStore.getVersion('version:stale-during'),
      /art_document_version_not_found/,
    );
    assert.equal(context.documentStore.getDocumentSnapshot(snapshot.document.documentId)
      .currentVersion.versionId, snapshot.currentVersion.versionId);

    const crossBase = await context.bridge.executeOperator({
      operationId: 'operation:v02:cross-version-base',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { width: 8, height: 8, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:cross-version-base',
        assetBindingId: 'binding:v02:cross-version-base',
      },
      now,
    });
    const callsBeforeCrossVersion = calls;
    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:cross-version-component',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.edge_cleanup', version: '1.0.0' },
      target: sourceTarget(snapshot, {
        targetKind: 'REGION',
        versionId: crossBase.candidate.version.versionId,
        componentId: 'region:v02:geometry-only',
      }),
      params: { radius: 1 },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'ASSET_ONLY' },
      now,
    }), /art_target_component_scope_mismatch/);
    assert.equal(calls, callsBeforeCrossVersion);
  } finally {
    close(context);
  }
});

test('rejects a provider result when current authority changes during execution', async () => {
  const real = new SharpRasterProvider({ now: () => verifiedAt });
  let afterExecute = null;
  const provider = {
    providerId: real.providerId,
    providerVersion: real.providerVersion,
    capability: () => real.capability(),
    execute: async request => {
      const result = await real.execute(request);
      if (afterExecute !== null) afterExecute();
      return result;
    },
  };
  const context = await setup({ provider });
  const now = clock();
  try {
    const source = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    const competing = await context.bridge.executeOperator({
      operationId: 'operation:v02:competing-candidate',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(source),
      params: { width: 12, height: 12, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:competing',
        assetBindingId: 'binding:v02:competing',
      },
      now,
    });
    context.bridge.recordEvaluation({
      schema: 'eve-atelier-art-evaluation/v1',
      evaluationId: 'evaluation:v02:competing',
      documentId: source.document.documentId,
      versionId: competing.candidate.version.versionId,
      verdict: 'ACCEPT',
      evaluator: { kind: 'DETERMINISTIC', id: 'validator:competing', version: '1.0.0' },
      measurements: { outputSha256: competing.asset.sha256 },
      evidenceRefs: ['evidence:v02:competing'],
      warnings: [],
      evaluatedAt: now(),
    });
    afterExecute = () => context.bridge.promoteCandidate({
      documentId: source.document.documentId,
      versionId: competing.candidate.version.versionId,
      evaluationId: 'evaluation:v02:competing',
      eventId: 'current:v02:competing',
      actor: human,
      evidenceRefs: ['evidence:v02:competing-promotion'],
      expectedCurrentVersionId: source.currentVersion.versionId,
      occurredAt: now(),
    });
    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:losing-race',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.recolor', version: '1.0.0' },
      target: sourceTarget(source),
      params: { tint: [0.8, 1, 1] },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:losing-race',
        assetBindingId: 'binding:v02:losing-race',
      },
      now,
    }), /art_target_stale_current/);
    assert.throws(
      () => context.documentStore.getVersion('version:v02:losing-race'),
      /art_document_version_not_found/,
    );
    assert.equal(context.documentStore.getDocumentSnapshot(source.document.documentId)
      .currentVersion.versionId, competing.candidate.version.versionId);
  } finally {
    close(context);
  }
});

test('rejects a provider output-hash lie before CAS and candidate commit', async () => {
  const real = new SharpRasterProvider({ now: () => verifiedAt });
  const liar = {
    providerId: real.providerId,
    providerVersion: real.providerVersion,
    capability: () => real.capability(),
    execute: async value => ({
      ...await real.execute(value),
      outputSha256: '0'.repeat(64),
    }),
  };
  const context = await setup({ provider: liar });
  try {
    const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:hash-lie',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { width: 8, height: 8, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: { kind: 'CANDIDATE_VERSION', versionId: 'version:lie', assetBindingId: 'binding:lie' },
      now: clock(),
    }), /provider_output_hash_mismatch/);
    assert.throws(() => context.documentStore.getVersion('version:lie'), /art_document_version_not_found/);
    assert.equal(context.documentStore.getDocumentSnapshot(snapshot.document.documentId)
      .currentVersion.versionId, snapshot.currentVersion.versionId);
  } finally {
    close(context);
  }
});

test('keeps document authority unchanged when CAS registration fails after provider output', async () => {
  const context = await setup();
  try {
    const rejectingAssets = {
      getAsset: id => context.assetStore.getAsset(id),
      getPath: asset => context.assetStore.getPath(asset),
      verifyAsset: asset => context.assetStore.verifyAsset(asset),
      registerDerivedFile() {
        throw new Error('synthetic_cas_registration_failure');
      },
    };
    const bridge = new WorkbenchExecutionBridge({
      assetStore: rejectingAssets,
      documentStore: context.documentStore,
      operatorStore: context.operatorStore,
      targetResolver: context.resolver,
      providers: [context.provider],
      manifests: [context.capability],
      stagingRoot: join(context.root, 'cas-failure-staging'),
    });
    const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    await assert.rejects(() => bridge.executeOperator({
      operationId: 'operation:v02:cas-registration-failure',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { width: 8, height: 8, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:cas-failed',
        assetBindingId: 'binding:v02:cas-failed',
      },
      now: clock(),
    }), /synthetic_cas_registration_failure/);
    assert.throws(
      () => context.documentStore.getVersion('version:v02:cas-failed'),
      /art_document_version_not_found/,
    );
    assert.equal(context.documentStore.getDocumentSnapshot(snapshot.document.documentId)
      .currentVersion.versionId, snapshot.currentVersion.versionId);
  } finally {
    close(context);
  }
});

test('exports a promoted resized version with its version extent after reopen', async () => {
  const context = await setup();
  const now = clock();
  let closed = false;
  try {
    const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    const resized = await context.bridge.executeOperator({
      operationId: 'operation:v02:resize-for-ora',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { width: 8, height: 7, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/png', outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:v02:ora-resized',
        assetBindingId: 'binding:v02:ora-resized',
      },
      now,
    });
    context.bridge.recordEvaluation({
      schema: 'eve-atelier-art-evaluation/v1',
      evaluationId: 'evaluation:v02:ora-resized',
      documentId: snapshot.document.documentId,
      versionId: resized.candidate.version.versionId,
      verdict: 'ACCEPT',
      evaluator: { kind: 'DETERMINISTIC', id: 'validator:extent', version: '1.0.0' },
      measurements: { width: 8, height: 7 },
      evidenceRefs: ['evidence:v02:ora-extent'],
      warnings: [],
      evaluatedAt: now(),
    });
    context.bridge.promoteCandidate({
      documentId: snapshot.document.documentId,
      versionId: resized.candidate.version.versionId,
      evaluationId: 'evaluation:v02:ora-resized',
      eventId: 'current:v02:ora-resized',
      actor: human,
      evidenceRefs: ['evidence:v02:ora-promotion'],
      expectedCurrentVersionId: snapshot.currentVersion.versionId,
      occurredAt: now(),
    });
    close(context);
    closed = true;
    const assets = new AssetStore({ root: join(context.root, 'assets') });
    const documents = new ArtDocumentStore({
      path: join(context.root, 'art.sqlite3'),
      assetStore: assets,
    });
    try {
      const ora = await exportCurrentOpenRaster({
        store: documents,
        assetStore: assets,
        documentId: snapshot.document.documentId,
        output: join(context.root, 'resized.ora'),
      });
      assert.deepEqual(ora.size, { width: 8, height: 7 });
    } finally {
      documents.close();
      assets.close();
    }
  } finally {
    if (!closed) close(context);
  }
});

test('rejects MIME and extension assertions that disagree with verified provider output', async () => {
  const context = await setup();
  try {
    const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    await assert.rejects(() => context.bridge.executeOperator({
      operationId: 'operation:v02:media-lie',
      packRef: context.packRef,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      target: sourceTarget(snapshot),
      params: { width: 8, height: 8, fit: 'fill' },
      providerPolicy: providerPolicy(context.capability),
      outputMediaType: 'image/jpeg',
      outputExtension: 'png',
      commit: {
        kind: 'CANDIDATE_VERSION',
        versionId: 'version:media-lie',
        assetBindingId: 'binding:media-lie',
      },
      now: clock(),
    }), /workbench_output_media_declaration_mismatch/);
    assert.throws(
      () => context.documentStore.getVersion('version:media-lie'),
      /art_document_version_not_found/,
    );
  } finally {
    close(context);
  }
});

test('records MRMIC uncertainty after document commit without retry or rollback', async () => {
  let calls = 0;
  const mrmicClient = {
    async projectPortal() {
      calls += 1;
      const error = new Error('uncertain');
      error.code = 'UNKNOWN_AFTER_DISPATCH';
      throw error;
    },
  };
  const context = await setup({ mrmicClient });
  try {
    const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
    const providerResourceId = `artasset://eveatelier/${snapshot.currentVersion.versionId}`
      + `?sha256=${snapshot.currentVersion.primaryAsset.sha256}`;
    const projection = {
      mode: 'CREATE',
      request: {
        idempotencyKey: 'idempotency:v02:portal',
        portal: {
          metadata: { portal: { providerResourceId } },
        },
      },
      projectionEventId: 'projection:v02:uncertain',
      documentId: snapshot.document.documentId,
      versionId: snapshot.currentVersion.versionId,
      projectionRole: 'CURRENT',
      idempotencyKey: 'idempotency:v02:portal',
      providerResourceId,
      evidenceRef: 'evidence:mrmic:unused',
      recordedAt: '2026-09-11T01:05:00Z',
    };
    await assert.rejects(() => context.bridge.projectPortalOnce({
      ...projection,
      request: { ...projection.request, idempotencyKey: 'idempotency:v02:different' },
    }), /art_projection_request_idempotency_mismatch/);
    assert.equal(calls, 0);
    const result = await context.bridge.projectPortalOnce(projection);
    assert.equal(result.status, 'UNCERTAIN');
    assert.equal(result.retryAuthorized, false);
    assert.equal(calls, 1);
    const replay = await context.bridge.projectPortalOnce(projection);
    assert.equal(replay.duplicateSuppressed, true);
    assert.equal(calls, 1);
    assert.equal(context.documentStore.listProjectionEvents(
      snapshot.document.documentId,
      snapshot.currentVersion.versionId,
    )[0].status, 'UNCERTAIN');
    assert.equal(context.documentStore.getDocumentSnapshot(snapshot.document.documentId)
      .currentVersion.versionId, snapshot.currentVersion.versionId);
    const crashKey = 'idempotency:v02:prepared-before-crash';
    context.documentStore.prepareProjectionAttempt({
      schema: 'eve-atelier-art-projection-attempt/v1',
      attemptId: 'projection-attempt:v02:prepared-before-crash',
      projectionEventId: 'projection:v02:prepared-before-crash',
      documentId: snapshot.document.documentId,
      versionId: snapshot.currentVersion.versionId,
      mode: 'CREATE',
      idempotencyKey: crashKey,
      providerResourceId,
      preparedAt: '2026-09-11T01:06:00Z',
    });
    const crashReplay = await context.bridge.projectPortalOnce({
      ...projection,
      projectionEventId: 'projection:v02:prepared-before-crash',
      idempotencyKey: crashKey,
      request: { ...projection.request, idempotencyKey: crashKey },
      recordedAt: '2026-09-11T01:06:00Z',
    });
    assert.equal(crashReplay.status, 'UNCERTAIN');
    assert.equal(crashReplay.duplicateSuppressed, true);
    assert.equal(crashReplay.retryAuthorized, false);
    assert.equal(calls, 1);
  } finally {
    close(context);
  }
});

test('projects through the real MRMIC client contract and persists verified readback', async () => {
  let revision = 0;
  let posts = 0;
  const objects = [];
  await withServer((request, response) => {
    if (request.method === 'GET' && request.url === '/api/capabilities') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(mrmicCapabilities));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/state')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        canvas: { id: 'canvas:v02', revision },
        objects,
      }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/transaction') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const transaction = JSON.parse(body);
        posts += 1;
        objects.push(structuredClone(transaction.operations[0].object));
        revision += 1;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ status: 'applied', canvasRevision: revision }));
      });
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
  }, async baseUrl => {
    const context = await setup({ mrmicClient: new MrmicClient({ baseUrl }) });
    try {
      const snapshot = context.documentStore.getDocumentSnapshot('document:synthetic:v02');
      const providerResourceId = `artasset://eveatelier/${snapshot.currentVersion.versionId}`
        + `?sha256=${snapshot.currentVersion.primaryAsset.sha256}`;
      const idempotencyKey = 'idempotency:v02:verified';
      const portal = buildArtResourcePortal({
        id: 'portal:v02:verified',
        canvasId: 'canvas:v02',
        workspaceId: 'workspace:synthetic:v02',
        providerResourceId,
        createdBy: { actorType: 'system', actorId: 'eve-atelier' },
        now: '2026-09-11T01:05:00Z',
        revision: 0,
      });
      const projection = await context.bridge.projectPortalOnce({
        mode: 'CREATE',
        request: {
          portal,
          expectedCanvasRevision: 0,
          actor: { actorType: 'system', actorId: 'eve-atelier' },
          idempotencyKey,
          now: '2026-09-11T01:05:00Z',
        },
        projectionEventId: 'projection:v02:verified',
        documentId: snapshot.document.documentId,
        versionId: snapshot.currentVersion.versionId,
        projectionRole: 'CURRENT',
        idempotencyKey,
        providerResourceId,
        evidenceRef: 'evidence:mrmic:verified-readback',
        recordedAt: '2026-09-11T01:05:00Z',
      });
      assert.equal(projection.status, 'VERIFIED');
      assert.equal(projection.result.portal.metadata.portal.provider, 'external');
      assert.equal(projection.result.portal.metadata.portal.resourceKind, 'artifact');
      assert.equal(projection.result.portal.metadata.ownershipTransferred, false);
      assert.equal(posts, 1);
      assert.equal(context.documentStore.getProjectionEventByIdempotencyKey(idempotencyKey)
        .status, 'VERIFIED');
      assert.equal(context.documentStore.getProjectionAttemptByIdempotencyKey(idempotencyKey)
        .providerResourceId, providerResourceId);
      const replay = await context.bridge.projectPortalOnce({
        mode: 'CREATE',
        request: {
          portal,
          expectedCanvasRevision: 0,
          actor: { actorType: 'system', actorId: 'eve-atelier' },
          idempotencyKey,
          now: '2026-09-11T01:05:00Z',
        },
        projectionEventId: 'projection:v02:verified',
        documentId: snapshot.document.documentId,
        versionId: snapshot.currentVersion.versionId,
        projectionRole: 'CURRENT',
        idempotencyKey,
        providerResourceId,
        evidenceRef: 'evidence:mrmic:verified-readback',
        recordedAt: '2026-09-11T01:05:00Z',
      });
      assert.equal(replay.duplicateSuppressed, true);
      assert.equal(posts, 1);
    } finally {
      close(context);
    }
  });
});
