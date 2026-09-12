import {
  buildAtlasSnapshotFromRecords,
  buildRetrievalContextFromAtlas,
  cosineSimilarity,
} from './style-atlas-core.js';

function required(value, methods, reason) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(reason);
  }
  return value;
}
export class StyleAtlas {
  #store;

  constructor({ store }) {
    this.#store = required(store, [
      'exportProjectRecords', 'getProjectRevision', 'recordAtlasSnapshot',
      'getAtlasSnapshot', 'recordRetrievalContext',
    ], 'style_atlas_store_required');
  }

  buildAndRecord({
    projectId,
    atlasSnapshotId,
    clusterThreshold = 0.9,
    createdAt,
  }) {
    const records = this.#store.exportProjectRecords(projectId);
    const value = buildAtlasSnapshotFromRecords({
      records,
      projectId,
      atlasSnapshotId,
      knowledgeRevision: this.#store.getProjectRevision(projectId),
      clusterThreshold,
      createdAt,
    });
    return this.#store.recordAtlasSnapshot(value);
  }

  buildAndRecordRetrieval({ atlasSnapshotId, retrievalContextId, query, createdAt }) {
    const atlas = this.#store.getAtlasSnapshot(atlasSnapshotId);
    const records = this.#store.exportProjectRecords(atlas.projectId);
    const value = buildRetrievalContextFromAtlas({
      atlas,
      records,
      query,
      retrievalContextId,
      createdAt,
    });
    return this.#store.recordRetrievalContext(value);
  }

  similarReferences({ projectId, referenceAssetId, limit = 10 }) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('style_atlas_similarity_limit_invalid');
    }
    const records = this.#store.exportProjectRecords(projectId);
    const anchors = records.featureObservations.filter(item => (
      item.referenceAssetId === referenceAssetId
    ));
    if (anchors.length === 0) throw new Error('style_atlas_reference_feature_missing');
    const results = [];
    for (const anchor of anchors) {
      for (const candidate of records.featureObservations) {
        if (candidate.referenceAssetId === referenceAssetId
            || candidate.extractor.id !== anchor.extractor.id
            || candidate.extractor.version !== anchor.extractor.version
            || candidate.extractor.spaceId !== anchor.extractor.spaceId
            || candidate.extractor.dimensions !== anchor.extractor.dimensions) continue;
        results.push({
          referenceAssetId: candidate.referenceAssetId,
          similarity: cosineSimilarity(anchor.vector, candidate.vector),
          extractorRef: structuredClone(anchor.extractor),
        });
      }
    }
    const best = new Map();
    for (const item of results) {
      if (!best.has(item.referenceAssetId)
          || best.get(item.referenceAssetId).similarity < item.similarity) {
        best.set(item.referenceAssetId, item);
      }
    }
    return [...best.values()]
      .sort((left, right) => right.similarity - left.similarity
        || left.referenceAssetId.localeCompare(right.referenceAssetId))
      .slice(0, limit);
  }
}
