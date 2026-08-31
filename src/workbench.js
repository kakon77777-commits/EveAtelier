import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateHumanReview } from './character-remaster/human-review.js';

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
      humanReview: null,
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
      humanReview: null,
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

  recordHumanReview({ documentId, versionId, review }) {
    const doc = this.#document(documentId);
    const version = doc.versions.get(versionId);
    if (!version || version.status !== 'candidate') throw new Error('candidate_not_found');
    version.humanReview = validateHumanReview(review, versionId);
    return structuredClone(version);
  }

  promoteCandidate({ documentId, versionId, approvedBy }) {
    const doc = this.#document(documentId);
    const candidate = doc.versions.get(versionId);
    if (!candidate || candidate.status !== 'candidate') throw new Error('candidate_not_found');
    if (!['ACCEPT', 'ACCEPT_WITH_WARNINGS'].includes(candidate.evaluation?.verdict)) {
      throw new Error('candidate_not_accepted');
    }
    if (doc.promotionPolicy === 'human_required') {
      if (!candidate.humanReview) throw new Error('human_approval_required');
      if (!['APPROVE', 'ACCEPT_WITH_WARNINGS'].includes(candidate.humanReview.disposition)) {
        throw new Error('human_review_rejected');
      }
    }
    const old = doc.versions.get(doc.currentVersionId);
    if (old) old.status = 'history';
    candidate.status = 'current';
    candidate.approvedBy = doc.promotionPolicy === 'human_required'
      ? `human:${candidate.humanReview.reviewer.id}`
      : approvedBy ?? 'validator:auto';
    doc.currentVersionId = versionId;
    return structuredClone(candidate);
  }

  exportState() {
    return {
      schema: 'eve-atelier-workbench/v1',
      projectId: this.projectId,
      documents: [...this.documents.values()].map(doc => ({
        documentId: doc.documentId,
        projectId: doc.projectId,
        promotionPolicy: doc.promotionPolicy,
        currentVersionId: doc.currentVersionId,
        nextVersion: doc.nextVersion,
        versions: [...doc.versions.values()].map(version => structuredClone(version)),
      })),
    };
  }

  static fromState(state) {
    if (!state || state.schema !== 'eve-atelier-workbench/v1' || !Array.isArray(state.documents)) {
      throw new Error('workbench_state_invalid');
    }
    const workbench = new EveAtelierWorkbench({ projectId: state.projectId });
    for (const document of state.documents) {
      if (!document || typeof document.documentId !== 'string' || !Array.isArray(document.versions)) {
        throw new Error('workbench_document_invalid');
      }
      if (workbench.documents.has(document.documentId)) throw new Error('duplicate_document_id');
      const versions = new Map();
      for (const rawVersion of document.versions) {
        const version = structuredClone(rawVersion);
        if (!version || typeof version.versionId !== 'string' || versions.has(version.versionId)) {
          throw new Error('duplicate_or_invalid_version_id');
        }
        if (hashFile(version.assetPath) !== version.assetHash) {
          throw new Error(`asset_hash_mismatch:${version.versionId}`);
        }
        if (version.humanReview) {
          version.humanReview = validateHumanReview(version.humanReview, version.versionId);
        }
        versions.set(version.versionId, version);
      }
      if (!versions.has(document.currentVersionId)
          || !Number.isInteger(document.nextVersion)
          || document.nextVersion < 1) {
        throw new Error('workbench_document_state_invalid');
      }
      workbench.documents.set(document.documentId, {
        documentId: document.documentId,
        projectId: document.projectId,
        promotionPolicy: document.promotionPolicy,
        currentVersionId: document.currentVersionId,
        nextVersion: document.nextVersion,
        versions,
      });
    }
    return workbench;
  }

  #document(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error('document_not_found');
    return doc;
  }
}
