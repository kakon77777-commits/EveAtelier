import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export class EveAtelierWorkbench {
  constructor({ projectId }) {
    if (!projectId) throw new TypeError('project_id_required');
    this.projectId = projectId;
    this.documents = new Map();
  }

  createDocument({ documentId, sourceAsset, promotionPolicy = 'human_required' }) {
    if (!documentId || !sourceAsset) throw new TypeError('document_id_and_source_required');
    if (this.documents.has(documentId)) throw new Error('document_exists');
    const versionId = `${documentId}:v0`;
    const version = {
      versionId,
      parentVersionIds: [],
      assetPath: sourceAsset,
      assetHash: hashFile(sourceAsset),
      status: 'current',
      evaluation: { verdict: 'SOURCE' },
      execution: null,
    };
    this.documents.set(documentId, {
      documentId,
      projectId: this.projectId,
      promotionPolicy,
      currentVersionId: versionId,
      nextVersion: 1,
      versions: new Map([[versionId, version]]),
    });
    return structuredClone(version);
  }

  getDocument(documentId) {
    const doc = this.#document(documentId);
    return {
      documentId: doc.documentId,
      projectId: doc.projectId,
      promotionPolicy: doc.promotionPolicy,
      currentVersionId: doc.currentVersionId,
      versions: [...doc.versions.values()].map(version => structuredClone(version)),
    };
  }

  getVersion(documentId, versionId) {
    const version = this.#document(documentId).versions.get(versionId);
    if (!version) throw new Error('version_not_found');
    return structuredClone(version);
  }

  getCurrentVersion(documentId) {
    const doc = this.#document(documentId);
    return this.getVersion(documentId, doc.currentVersionId);
  }

  stageCandidate({ documentId, parentVersionId, assetPath, execution, evaluation }) {
    const doc = this.#document(documentId);
    if (!doc.versions.has(parentVersionId)) throw new Error('parent_version_not_found');
    const versionId = `${documentId}:v${doc.nextVersion++}`;
    const candidate = {
      versionId,
      parentVersionIds: [parentVersionId],
      assetPath,
      assetHash: hashFile(assetPath),
      status: 'candidate',
      evaluation: evaluation ? structuredClone(evaluation) : { verdict: 'UNVERIFIED' },
      execution: execution ? structuredClone(execution) : null,
    };
    doc.versions.set(versionId, candidate);
    return structuredClone(candidate);
  }

  recordEvaluation({ documentId, versionId, evaluation }) {
    const doc = this.#document(documentId);
    const version = doc.versions.get(versionId);
    if (!version) throw new Error('version_not_found');
    version.evaluation = structuredClone(evaluation);
    return structuredClone(version);
  }

  promoteCandidate({ documentId, versionId, approvedBy }) {
    const doc = this.#document(documentId);
    const candidate = doc.versions.get(versionId);
    if (!candidate || candidate.status !== 'candidate') throw new Error('candidate_not_found');
    if (!['ACCEPT', 'ACCEPT_WITH_WARNINGS'].includes(candidate.evaluation?.verdict)) {
      throw new Error('candidate_not_accepted');
    }
    if (doc.promotionPolicy === 'human_required' && (!approvedBy || !approvedBy.startsWith('human:'))) {
      throw new Error('human_approval_required');
    }
    const old = doc.versions.get(doc.currentVersionId);
    if (old) old.status = 'history';
    candidate.status = 'current';
    candidate.approvedBy = approvedBy ?? 'validator:auto';
    doc.currentVersionId = versionId;
    return structuredClone(candidate);
  }

  #document(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error('document_not_found');
    return doc;
  }
}
