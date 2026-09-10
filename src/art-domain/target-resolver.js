import { createHash } from 'node:crypto';
import { canonicalJson } from '../operator-runtime/canonical.js';
import {
  cloneArtValue,
  normalizeArtValue,
  validateArtOperatorTarget,
} from './contracts.js';

function evidenceDigest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export class ArtTargetResolver {
  #store;
  #assetStore;

  constructor({ store, assetStore }) {
    if (!store || typeof store.getDocumentSnapshot !== 'function') {
      throw new TypeError('art_document_store_required');
    }
    if (!assetStore || typeof assetStore.getPath !== 'function') {
      throw new TypeError('asset_store_required');
    }
    this.#store = store;
    this.#assetStore = assetStore;
  }

  resolve(target, { observedCanvasRevision = null } = {}) {
    target = normalizeArtValue(target, 'art_operator_target_json_value_invalid');
    const validation = validateArtOperatorTarget(target);
    if (!validation.ok) throw new Error(validation.reason);
    const document = this.#store.getDocument(target.documentId);
    if (document.projectId !== target.projectId) throw new Error('art_target_project_mismatch');
    const version = this.#store.getVersion(target.versionId);
    if (version.documentId !== target.documentId) throw new Error('art_target_version_mismatch');
    const snapshot = this.#store.getDocumentSnapshot(target.documentId);
    const componentGraph = this.#store.getVersionGraphSeal(target.versionId);
    if (target.expectedCurrentVersionId !== null
        && snapshot.currentVersion.versionId !== target.expectedCurrentVersionId) {
      throw new Error(`art_target_stale_current:${snapshot.currentVersion.versionId}`);
    }
    if (snapshot.documentRevision !== target.expectedDocumentRevision) {
      throw new Error(`art_target_stale_document_revision:${snapshot.documentRevision}`);
    }
    if (target.expectedCanvasRevision !== null) {
      if (!Number.isSafeInteger(observedCanvasRevision)) {
        throw new Error('art_target_canvas_revision_observation_required');
      }
      if (target.expectedCanvasRevision !== observedCanvasRevision) {
        throw new Error(`art_target_stale_canvas_revision:${observedCanvasRevision}`);
      }
    }
    const component = this.#component(target);
    if (component !== null
        && (component.documentId !== target.documentId
          || component.versionId !== target.versionId)) {
      throw new Error('art_target_component_scope_mismatch');
    }
    this.#assetStore.verifyAsset(version.primaryAsset);
    const componentRevision = component?.revision
      ?? component?.representation?.revision
      ?? 0;
    const evidence = {
      targetId: target.targetId,
      documentId: target.documentId,
      versionId: target.versionId,
      primaryAssetSha256: version.primaryAsset.sha256,
      documentRevision: snapshot.documentRevision,
      componentId: target.componentId,
      componentRevision,
      componentGraphDigest: componentGraph.componentDigest,
      canvasRevision: observedCanvasRevision,
    };
    return {
      schema: 'eve-atelier-resolved-art-target/v1',
      target: cloneArtValue(target),
      document,
      version,
      primaryAsset: cloneArtValue(version.primaryAsset),
      component,
      currentVersionId: snapshot.currentVersion.versionId,
      documentRevision: snapshot.documentRevision,
      componentRevision,
      componentGraphDigest: componentGraph.componentDigest,
      observedCanvasRevision,
      revisionEvidenceRef: `evidence:art-target:${evidenceDigest(evidence)}`,
    };
  }

  revalidate(resolved, options = {}) {
    if (!resolved || resolved.schema !== 'eve-atelier-resolved-art-target/v1') {
      throw new TypeError('resolved_art_target_required');
    }
    const current = this.resolve(resolved.target, options);
    if (current.revisionEvidenceRef !== resolved.revisionEvidenceRef) {
      throw new Error('art_target_changed_during_execution');
    }
    return current;
  }

  primaryAssetPath(resolved) {
    if (!resolved || resolved.schema !== 'eve-atelier-resolved-art-target/v1') {
      throw new TypeError('resolved_art_target_required');
    }
    return this.#assetStore.getPath(resolved.primaryAsset);
  }

  pixelMask(resolved) {
    if (!resolved || resolved.schema !== 'eve-atelier-resolved-art-target/v1') {
      throw new TypeError('resolved_art_target_required');
    }
    let asset;
    if (resolved.target.targetKind === 'MASK') {
      asset = resolved.component.assetRef;
    } else if (resolved.target.targetKind === 'SELECTION') {
      if (resolved.component.representation.kind !== 'MASK') {
        throw new Error('art_selection_not_pixel_mask');
      }
      asset = resolved.component.representation.assetRef;
    } else if (resolved.target.targetKind === 'REGION') {
      if (resolved.component.representation.kind !== 'MASK') {
        throw new Error('art_region_not_pixel_mask');
      }
      asset = this.#store.getMask(resolved.component.representation.refId).assetRef;
    } else {
      throw new Error('art_target_not_pixel_mask');
    }
    this.#assetStore.verifyAsset(asset);
    return { asset: cloneArtValue(asset), path: this.#assetStore.getPath(asset) };
  }

  #component(target) {
    switch (target.targetKind) {
      case 'DOCUMENT':
      case 'DOCUMENT_VERSION':
        return null;
      case 'LAYER':
        return this.#store.getLayer(target.componentId);
      case 'MASK':
        return this.#store.getMask(target.componentId);
      case 'SELECTION':
        return this.#store.getSelection(target.componentId);
      case 'REGION':
        return this.#store.getRegion(target.componentId);
      case 'STRUCTURE':
        return this.#store.getStructureBinding(target.componentId);
      case 'FIELD':
        return this.#store.getFieldBinding(target.componentId);
      default:
        throw new Error('art_target_kind_unsupported');
    }
  }
}
