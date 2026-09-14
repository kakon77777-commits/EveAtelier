import { validateArtActor } from '../art-domain/contracts.js';
import { bindReferenceDrivenIntent } from '../visual-knowledge/reference-intent.js';
import {
  normalizeSurfaceValue,
  validateSurfaceIntentCommand,
  validateSurfaceReviewCommand,
  validateWorkspaceKey,
} from './contracts.js';

function required(value, methods, reason) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(reason);
  }
  return value;
}

function assertValid(validation) {
  if (!validation.ok) throw new Error(validation.reason);
}

function clone(value) {
  return structuredClone(value);
}

const privateString = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|users|var|tmp|opt)\/|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,})/i;

function publicValue(value) {
  if (typeof value === 'string') return privateString.test(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicValue(item)]));
  }
  return value;
}

function last(values) {
  return values.length === 0 ? null : values.at(-1);
}

function publicAsset(asset, projectId, documentId) {
  const search = new URLSearchParams({
    projectId,
    documentId,
    assetId: asset.assetId,
  });
  return {
    assetId: asset.assetId,
    sha256: asset.sha256,
    mediaType: asset.mediaType,
    byteSize: asset.byteSize,
    url: `/api/assets?${search}`,
  };
}

function candidateFromOutput(snapshot) {
  return last(Object.values(snapshot.outputs)
    .filter(output => typeof output?.candidateVersionId === 'string'))?.candidateVersionId ?? null;
}

function evaluationFromOutput(snapshot) {
  return last(Object.values(snapshot.outputs)
    .filter(output => typeof output?.evaluationId === 'string'))?.evaluationId ?? null;
}

function publicEvaluation(value) {
  if (value === null) return null;
  return {
    evaluationId: value.evaluationId,
    verdict: value.verdict,
    evaluator: publicValue(value.evaluator),
    measurements: publicValue(value.measurements),
    warnings: publicValue(value.warnings),
    evidenceRefs: publicValue(value.evidenceRefs),
    evaluatedAt: value.evaluatedAt,
  };
}

function publicReview(value) {
  if (value === null) return null;
  return {
    reviewId: value.reviewId,
    disposition: value.disposition,
    reason: publicValue(value.reason),
    reviewer: publicValue(value.reviewer),
    evidenceRefs: publicValue(value.evidenceRefs),
    reviewedAt: value.reviewedAt,
  };
}

function publicSession(snapshot) {
  return {
    sessionId: snapshot.session.sessionId,
    goal: publicValue(snapshot.session.goal),
    taskType: snapshot.session.taskType,
    status: snapshot.status,
    currentNodeId: snapshot.currentNodeId,
    terminalOutcome: snapshot.terminalOutcome,
    usage: clone(snapshot.usage),
    createdAt: snapshot.session.createdAt,
  };
}

export function sortHumanHistory(values) {
  if (!Array.isArray(values)) throw new TypeError('human_surface_history_invalid');
  return [...values].sort((left, right) => {
    const leftTime = Date.parse(left?.at);
    const rightTime = Date.parse(right?.at);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
      throw new Error('human_surface_history_time_invalid');
    }
    return leftTime - rightTime || left.historyId.localeCompare(right.historyId);
  });
}

export class HumanWorkbenchSurface {
  #artStore;
  #assetStore;
  #visualStore;
  #knowledgeStore;
  #controller;
  #sessionPolicy;
  #humanActor;
  #now;
  #idFactory;
  #defaultWorkspace;

  constructor({
    artDocumentStore,
    assetStore,
    visualIntelligenceStore,
    knowledgeStore,
    controller,
    sessionPolicy,
    humanActor,
    now = () => new Date().toISOString(),
    idFactory,
    defaultWorkspace,
  }) {
    this.#artStore = required(artDocumentStore, [
      'getDocumentSnapshot', 'listVersions', 'listEvaluations', 'listHumanReviews',
      'listCurrentEvents',
    ], 'human_surface_art_store_required');
    this.#assetStore = required(assetStore, [
      'getAsset', 'getPath', 'verifyAsset',
    ], 'human_surface_asset_store_required');
    this.#visualStore = required(visualIntelligenceStore, [
      'getSessionSnapshot', 'listSessions', 'listEvents',
    ], 'human_surface_visual_store_required');
    this.#knowledgeStore = required(knowledgeStore, [
      'getRecord', 'listRecords', 'getProjectRevision', 'getRetrievalContext',
    ], 'human_surface_knowledge_store_required');
    this.#controller = required(controller, [
      'startSession', 'run', 'submitHumanDecision',
    ], 'human_surface_controller_required');
    if (typeof sessionPolicy !== 'function') throw new TypeError('human_surface_policy_required');
    if (!validateArtActor(humanActor, ['HUMAN'])) {
      throw new TypeError('human_surface_human_actor_required');
    }
    if (typeof now !== 'function') throw new TypeError('human_surface_clock_required');
    if (typeof idFactory !== 'function') throw new TypeError('human_surface_id_factory_required');
    assertValid(validateWorkspaceKey(defaultWorkspace));
    this.#sessionPolicy = sessionPolicy;
    this.#humanActor = clone(humanActor);
    this.#now = now;
    this.#idFactory = idFactory;
    this.#defaultWorkspace = clone(defaultWorkspace);
  }

  getConfig() {
    return {
      schema: 'eve-atelier-human-surface-config/v1',
      productVersion: '0.5.0-rc.1',
      ...clone(this.#defaultWorkspace),
    };
  }

  #assertWorkspaceAccess({ projectId, documentId }) {
    if (projectId !== this.#defaultWorkspace.projectId
        || documentId !== this.#defaultWorkspace.documentId) {
      throw new Error('human_surface_workspace_forbidden');
    }
  }

  #asset(asset, projectId, documentId) {
    this.#assetStore.verifyAsset(asset);
    return publicAsset(asset, projectId, documentId);
  }

  getWorkspace(raw) {
    const key = normalizeSurfaceValue(raw, 'human_surface_workspace_key_invalid');
    assertValid(validateWorkspaceKey(key));
    this.#assertWorkspaceAccess(key);
    const art = this.#artStore.getDocumentSnapshot(key.documentId);
    if (art.document.projectId !== key.projectId) throw new Error('human_surface_project_mismatch');
    const versions = this.#artStore.listVersions(key.documentId);
    const evaluations = this.#artStore.listEvaluations(key.documentId);
    const reviews = this.#artStore.listHumanReviews(key.documentId);
    const currentEvents = this.#artStore.listCurrentEvents(key.documentId);
    const sessions = this.#visualStore.listSessions(key);
    const snapshots = sessions.map(session => this.#visualStore.getSessionSnapshot(session.sessionId));
    const referenceAssets = this.#knowledgeStore.listRecords('REFERENCE_ASSET', key.projectId);
    const referenceRoles = this.#knowledgeStore.listRecords('REFERENCE_ROLE', key.projectId);
    const sources = new Map(this.#knowledgeStore.listRecords('SOURCE_IDENTITY', key.projectId)
      .map(source => [source.sourceIdentityId, source]));

    const reviewableVersionIds = new Set([
      ...evaluations.map(item => item.versionId),
      ...reviews.map(item => item.versionId),
      ...snapshots.map(candidateFromOutput).filter(Boolean),
    ]);
    const candidateCompare = versions.filter(version => (
      version.kind === 'CANDIDATE' && reviewableVersionIds.has(version.versionId)
    ))
      .map(version => ({
        versionId: version.versionId,
        parentVersionIds: [...version.parentVersionIds],
        current: version.versionId === art.currentVersion.versionId,
        asset: this.#asset(version.primaryAsset, key.projectId, key.documentId),
        evaluation: publicEvaluation(last(evaluations.filter(item => (
          item.versionId === version.versionId
        )))),
        review: publicReview(last(reviews.filter(item => item.versionId === version.versionId))),
        createdAt: version.createdAt,
      }));

    const referenceBoard = referenceAssets.map(reference => ({
      referenceAssetId: reference.referenceAssetId,
      labels: publicValue(reference.labels),
      rightsClass: sources.get(reference.sourceIdentityId)?.rightsClass ?? 'UNKNOWN',
      asset: this.#asset(reference.assetRef, key.projectId, key.documentId),
      roleBindings: referenceRoles.filter(role => (
        role.referenceAssetId === reference.referenceAssetId
      )).map(role => ({
        roleBindingId: role.roleBindingId,
        role: role.role,
        allowedInfluence: publicValue(role.allowedInfluence),
        scope: publicValue(role.scope),
      })).sort((left, right) => left.role.localeCompare(right.role)
        || left.roleBindingId.localeCompare(right.roleBindingId)),
    })).sort((left, right) => left.referenceAssetId.localeCompare(right.referenceAssetId));

    const reviewQueue = snapshots.filter(snapshot => snapshot.status === 'WAITING_HUMAN')
      .map(snapshot => ({
        sessionId: snapshot.session.sessionId,
        nodeId: snapshot.currentNodeId,
        goal: publicValue(snapshot.session.goal),
        candidateVersionId: candidateFromOutput(snapshot),
        evaluationId: evaluationFromOutput(snapshot),
      }));

    const history = sortHumanHistory([
      ...currentEvents.map(event => ({
        historyId: `art:${event.eventId}`,
        kind: 'ART_CURRENT',
        type: event.reason === 'PROMOTION' ? 'PROMOTE' : event.reason,
        summary: `${event.fromVersionId ?? '∅'} → ${event.toVersionId}`,
        actor: publicValue(event.actor),
        at: event.occurredAt,
      })),
      ...snapshots.flatMap(snapshot => this.#visualStore.listEvents(snapshot.session.sessionId)
        .map(event => ({
          historyId: `aads:${event.eventId}`,
          kind: 'AADS_EVENT',
          type: event.type,
          summary: publicValue(event.decision ?? event.nodeId ?? snapshot.session.goal),
          actor: publicValue(event.actor),
          at: event.occurredAt,
        }))),
    ]);

    return {
      schema: 'eve-atelier-human-workspace/v1',
      project: {
        projectId: art.document.projectId,
        documentId: art.document.documentId,
        documentType: art.document.documentType,
        promotionPolicy: art.document.promotionPolicy,
      },
      canvas: {
        currentVersionId: art.currentVersion.versionId,
        documentRevision: art.documentRevision,
        width: art.currentVersion.canvasExtent.width,
        height: art.currentVersion.canvasExtent.height,
        colorSpace: art.currentVersion.colorSpace,
        asset: this.#asset(art.currentVersion.primaryAsset, key.projectId, key.documentId),
      },
      referenceBoard,
      candidateCompare,
      sessions: snapshots.map(publicSession),
      reviewQueue,
      history,
      knowledgeRevision: this.#knowledgeStore.getProjectRevision(key.projectId),
    };
  }

  async submitIntent(raw) {
    const command = normalizeSurfaceValue(raw, 'human_surface_intent_command_invalid');
    assertValid(validateSurfaceIntentCommand(command));
    this.#assertWorkspaceAccess(command);
    const art = this.#artStore.getDocumentSnapshot(command.documentId);
    if (art.document.projectId !== command.projectId) throw new Error('human_surface_project_mismatch');
    for (const id of command.retrievalContextRefs) {
      const retrieval = this.#knowledgeStore.getRetrievalContext(id);
      if (retrieval.projectId !== command.projectId) {
        throw new Error('human_surface_retrieval_project_mismatch');
      }
    }
    const intentId = this.#idFactory('intent');
    const submittedAt = this.#now();
    let intent = {
      schema: 'eve-atelier-visual-intent/v1',
      intentId,
      projectId: command.projectId,
      documentId: command.documentId,
      text: command.text,
      taskTypeHint: command.taskTypeHint,
      references: [],
      preferences: clone(command.preferences),
      hardConstraints: clone(command.hardConstraints),
      overrides: command.overrides.map(item => ({ ...clone(item), actor: clone(this.#humanActor) })),
      submittedBy: clone(this.#humanActor),
      submittedAt,
    };
    if (command.roleBindingIds.length > 0) {
      intent = bindReferenceDrivenIntent({
        baseIntent: intent,
        directives: command.roleBindingIds.map(roleBindingId => ({
          directiveId: this.#idFactory('reference-direction'),
          roleBindingId,
        })),
        knowledgeStore: this.#knowledgeStore,
      });
    }
    const policy = this.#sessionPolicy({
      projectId: command.projectId,
      documentId: command.documentId,
      intent: clone(intent),
    });
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new Error('human_surface_session_policy_invalid');
    }
    const sessionId = this.#idFactory('session');
    const started = this.#controller.startSession({
      intent,
      sessionId,
      packetId: this.#idFactory('packet'),
      planId: this.#idFactory('plan'),
      workflowId: this.#idFactory('workflow'),
      contextSnapshotId: this.#idFactory('context'),
      contextVersion: policy.contextVersion,
      packRef: clone(policy.packRef),
      providerPolicy: clone(policy.providerPolicy),
      budget: clone(policy.budget),
      authority: clone(policy.authority),
      glossary: clone(policy.glossary ?? []),
      evidenceRefs: clone(policy.evidenceRefs ?? []),
      canvasRevision: policy.canvasRevision ?? null,
      retrievalContextRefs: [...command.retrievalContextRefs],
    });
    const snapshot = await this.#controller.run(started.session.sessionId);
    return {
      schema: 'eve-atelier-human-intent-result/v1',
      session: snapshot,
      workspace: this.getWorkspace({
        projectId: command.projectId,
        documentId: command.documentId,
      }),
    };
  }

  async submitReview(raw) {
    const command = normalizeSurfaceValue(raw, 'human_surface_review_command_invalid');
    assertValid(validateSurfaceReviewCommand(command));
    this.#assertWorkspaceAccess(command);
    const before = this.#visualStore.getSessionSnapshot(command.sessionId);
    if (before.session.projectId !== command.projectId
        || before.session.documentId !== command.documentId) {
      throw new Error('human_surface_review_session_scope_mismatch');
    }
    if (before.status !== 'WAITING_HUMAN') throw new Error('human_surface_review_gate_not_current');
    this.#controller.submitHumanDecision({
      sessionId: command.sessionId,
      decision: command.decision,
      reason: command.reason,
      reviewer: clone(this.#humanActor),
    });
    const snapshot = await this.#controller.run(command.sessionId);
    return {
      schema: 'eve-atelier-human-review-result/v1',
      session: snapshot,
      workspace: this.getWorkspace({
        projectId: before.session.projectId,
        documentId: before.session.documentId,
      }),
    };
  }

  resolveAssetFile(raw) {
    const request = normalizeSurfaceValue(raw, 'human_surface_asset_request_invalid');
    if (!request
        || Object.keys(request).length !== 3
        || !['projectId', 'documentId', 'assetId'].every(key => (
          typeof request[key] === 'string' && request[key].length > 0
        ))) throw new Error('human_surface_asset_request_invalid');
    this.#assertWorkspaceAccess(request);
    const art = this.#artStore.getDocumentSnapshot(request.documentId);
    if (art.document.projectId !== request.projectId) throw new Error('human_surface_project_mismatch');
    const versionOwned = this.#artStore.listVersions(request.documentId)
      .some(version => version.primaryAsset.assetId === request.assetId);
    const referenceOwned = this.#knowledgeStore.listRecords('REFERENCE_ASSET', request.projectId)
      .some(reference => reference.assetRef.assetId === request.assetId);
    if (!versionOwned && !referenceOwned) throw new Error('human_surface_asset_not_in_scope');
    const asset = this.#assetStore.getAsset(request.assetId);
    this.#assetStore.verifyAsset(asset);
    return {
      path: this.#assetStore.getPath(asset),
      mediaType: asset.mediaType,
      byteSize: asset.byteSize,
      sha256: asset.sha256,
    };
  }
}
