import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { canonicalJson } from '../operator-runtime/canonical.js';
import { inspectOpenRaster, writeOpenRaster } from '../openraster.js';

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function buildArtDocumentManifest({ store, documentId }) {
  const snapshot = store.getDocumentSnapshot(documentId);
  const versions = store.listVersions(documentId).map(version => ({
    version,
    graphSeal: store.getVersionGraphSeal(version.versionId),
    assetBindings: store.listAssetBindings(documentId, version.versionId),
    layers: store.listLayers(documentId, version.versionId),
    masks: store.listMasks(documentId, version.versionId),
    selections: store.listSelections(documentId, version.versionId),
    regions: store.listRegions(documentId, version.versionId),
    structureBindings: store.listStructureBindings(documentId, version.versionId),
    fieldBindings: store.listFieldBindings(documentId, version.versionId),
  }));
  return {
    schema: 'eve-atelier-art-document-manifest/v1',
    document: snapshot.document,
    currentVersionId: snapshot.currentVersion.versionId,
    documentRevision: snapshot.documentRevision,
    versions,
  };
}

export function writeArtDocumentManifest({ store, documentId, output }) {
  if (existsSync(output)) throw new Error('art_manifest_output_exists');
  const manifest = buildArtDocumentManifest({ store, documentId });
  writeFileSync(output, `${canonicalJson(manifest)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { manifest, sha256: hash(output) };
}

export function inspectArtDocumentManifest(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value
      || value.schema !== 'eve-atelier-art-document-manifest/v1'
      || !value.document
      || typeof value.currentVersionId !== 'string'
      || !Number.isSafeInteger(value.documentRevision)
      || !Array.isArray(value.versions)) {
    throw new Error('art_document_manifest_invalid');
  }
  return value;
}

export function exportCurrentRaster({ store, assetStore, documentId, output }) {
  if (existsSync(output)) throw new Error('art_export_output_exists');
  const snapshot = store.getDocumentSnapshot(documentId);
  const source = assetStore.getPath(snapshot.currentVersion.primaryAsset);
  copyFileSync(source, output, constants.COPYFILE_EXCL);
  if (hash(output) !== snapshot.currentVersion.primaryAsset.sha256) {
    throw new Error('art_export_hash_mismatch');
  }
  return {
    versionId: snapshot.currentVersion.versionId,
    asset: snapshot.currentVersion.primaryAsset,
    outputSha256: hash(output),
  };
}

export async function exportCurrentOpenRaster({
  store,
  assetStore,
  documentId,
  output,
}) {
  if (existsSync(output)) throw new Error('art_export_output_exists');
  const snapshot = store.getDocumentSnapshot(documentId);
  const documentLayers = store.listLayers(documentId, snapshot.currentVersion.versionId);
  if (documentLayers.some(layer => (
    layer.layerType === 'GROUP'
    || layer.parentLayerId !== null
    || layer.maskIds.length > 0
    || layer.blendMode !== 'over'
  ))) {
    throw new Error('art_openraster_complex_layer_projection_not_supported');
  }
  const layers = documentLayers
    .filter(layer => layer.layerType !== 'GROUP' && layer.assetRef !== null)
    .sort((left, right) => left.order - right.order)
    .map(layer => ({
      name: layer.name,
      src: assetStore.getPath(layer.assetRef),
      opacity: layer.opacity,
      visible: layer.visibility,
    }));
  if (layers.length === 0) {
    layers.push({
      name: 'Primary',
      src: assetStore.getPath(snapshot.currentVersion.primaryAsset),
      opacity: 1,
      visible: true,
    });
  }
  await writeOpenRaster({
    output,
    width: snapshot.currentVersion.canvasExtent.width,
    height: snapshot.currentVersion.canvasExtent.height,
    layers,
    name: snapshot.document.canonicalName ?? snapshot.document.documentId,
  });
  return inspectOpenRaster(output);
}
