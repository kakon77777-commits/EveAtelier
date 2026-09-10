import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetStore } from '../../src/art-domain/asset-store.js';
import { ArtDocumentStore } from '../../src/art-domain/store.js';
import {
  buildArtDocumentManifest,
  exportCurrentOpenRaster,
  exportCurrentRaster,
  inspectArtDocumentManifest,
  writeArtDocumentManifest,
} from '../../src/art-domain/interchange.js';
import { documentRecord, projectRecord, writeSubject } from './helpers.js';

const at = '2026-09-11T02:00:00Z';

test('exports public sidecar, exact raster, and OpenRaster from one current document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-interchange-'));
  const source = await writeSubject(join(root, 'source.png'));
  const assetStore = new AssetStore({ root: join(root, 'assets') });
  const store = new ArtDocumentStore({ path: join(root, 'art.sqlite3'), assetStore });
  try {
    store.registerProject(projectRecord(at));
    const document = documentRecord(at);
    const asset = assetStore.registerFile({ sourcePath: source, mediaType: 'image/png', registeredAt: at });
    const version = {
      schema: 'eve-atelier-art-document-version/v1',
      versionId: 'version:interchange:v0',
      documentId: document.documentId,
      parentVersionIds: [],
      primaryAsset: asset,
      primaryAssetStatus: 'CURRENT_RENDER',
      canvasExtent: structuredClone(document.canvasExtent),
      colorSpace: document.colorSpace,
      createdByExecutionId: null,
      createdAt: at,
      kind: 'SOURCE',
    };
    store.createDocumentWithSource({
      document,
      version,
      assetBinding: {
        schema: 'eve-atelier-art-asset-binding/v1',
        bindingId: 'binding:interchange:v0',
        documentId: document.documentId,
        versionId: version.versionId,
        assetRef: asset,
        assetRole: 'PRIMARY',
        target: { kind: 'DOCUMENT_VERSION', id: version.versionId },
        createdAt: at,
      },
      currentEvent: {
        schema: 'eve-atelier-art-current-event/v1',
        eventId: 'current:interchange:initial',
        documentId: document.documentId,
        fromVersionId: null,
        toVersionId: version.versionId,
        reason: 'INITIAL',
        evaluationId: null,
        reviewId: null,
        evidenceRefs: ['evidence:interchange:source'],
        actor: { kind: 'HUMAN', id: 'human:interchange' },
        occurredAt: at,
      },
      components: {
        layers: [{
          schema: 'eve-atelier-art-layer/v1',
          layerId: 'layer:interchange:base',
          documentId: document.documentId,
          versionId: version.versionId,
          name: 'Base',
          layerType: 'RASTER',
          order: 0,
          visibility: true,
          opacity: 1,
          blendMode: 'over',
          parentLayerId: null,
          assetRef: asset,
          maskIds: [],
          createdAt: at,
        }],
      },
    });

    const built = buildArtDocumentManifest({ store, documentId: document.documentId });
    assert.equal(built.currentVersionId, version.versionId);
    assert.equal(built.versions[0].layers[0].layerId, 'layer:interchange:base');
    const sidecar = join(root, 'document.eve.json');
    const written = writeArtDocumentManifest({ store, documentId: document.documentId, output: sidecar });
    assert.match(written.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(inspectArtDocumentManifest(sidecar), written.manifest);

    const png = join(root, 'export.png');
    const raster = exportCurrentRaster({ store, assetStore, documentId: document.documentId, output: png });
    assert.equal(raster.outputSha256, createHash('sha256').update(readFileSync(source)).digest('hex'));
    const ora = join(root, 'export.ora');
    const oraInfo = await exportCurrentOpenRaster({
      store,
      assetStore,
      documentId: document.documentId,
      output: ora,
    });
    assert.equal(oraInfo.mimetype, 'image/openraster');
    assert.deepEqual(oraInfo.layers.map(layer => layer.name), ['Base']);
  } finally {
    store.close();
    assetStore.close();
  }
});
