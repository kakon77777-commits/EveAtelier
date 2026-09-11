import { compileVisualIntent } from './constraint-compiler.js';
import { buildVisualPlanAndWorkflow } from './planner.js';
import {
  buildProjectContextSnapshot,
  buildWorkerContextProjection,
} from './context-home.js';
import { RabclRuntime } from './rabcl-runtime.js';
import { normalizeVisualValue, validateVisualIntent } from './contracts.js';

function required(value, methods, reason) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(reason);
  }
  return value;
}

export class AadsController {
  #store;
  #operatorStore;
  #adapter;
  #runtime;
  #now;

  constructor({ store, operatorStore, adapter, now = () => new Date().toISOString() }) {
    this.#store = required(
      store,
      [
        'registerSessionBundle',
        'getSessionSnapshot', 'getContextSnapshot',
        'registerWorkerProfile', 'recordWorkerProjection',
      ],
      'aads_store_required',
    );
    this.#operatorStore = required(
      operatorStore,
      ['getPack', 'getStatus'],
      'aads_operator_store_required',
    );
    this.#adapter = required(adapter, ['getArtSnapshot'], 'aads_workbench_adapter_required');
    if (typeof now !== 'function') throw new TypeError('aads_clock_required');
    this.#now = now;
    this.#runtime = new RabclRuntime({ store, adapter, now });
  }

  startSession({
    intent,
    sessionId,
    packetId,
    planId,
    workflowId,
    contextSnapshotId,
    contextVersion,
    packRef,
    providerPolicy,
    budget,
    authority,
    glossary = [],
    evidenceRefs = [],
    canvasRevision = null,
  }) {
    const normalizedIntent = normalizeVisualValue(intent, 'aads_visual_intent_json_value_invalid');
    const intentValidation = validateVisualIntent(normalizedIntent);
    if (!intentValidation.ok) throw new Error(intentValidation.reason);
    const art = this.#adapter.getArtSnapshot(normalizedIntent.documentId);
    const humanReview = art.document.promotionPolicy === 'human_required';
    const compiledAt = this.#now();
    const packet = compileVisualIntent(normalizedIntent, {
      packetId,
      compiledAt,
      allowedPrivacy: providerPolicy.allowedPrivacy,
      requireLocal: providerPolicy.allowedPrivacy.length === 1
        && providerPolicy.allowedPrivacy[0] === 'LOCAL',
      maxCostUnits: budget.maxCostUnits,
      maxLatencyMs: budget.maxLatencyMs,
      humanReview,
    });
    const { plan, workflow } = buildVisualPlanAndWorkflow({
      packet,
      packRef,
      operatorStore: this.#operatorStore,
      planId,
      workflowId,
      providerPolicy,
      createdAt: this.#now(),
    });
    const context = buildProjectContextSnapshot({
      schema: 'eve-atelier-project-context-snapshot/v1',
      contextSnapshotId,
      projectId: normalizedIntent.projectId,
      contextVersion,
      glossary,
      operatorPackRefs: [structuredClone(packRef)],
      artDocuments: [{
        documentId: normalizedIntent.documentId,
        versionId: art.currentVersion.versionId,
        documentRevision: art.documentRevision,
        componentGraphDigest: art.componentGraph.componentDigest,
      }],
      activeSessionRefs: [sessionId],
      evidenceRefs,
      sourceAuthorities: {
        operatorRegistry: 'eve-atelier:operator-registry',
        artDocumentStore: 'eve-atelier:art-document-store',
        assetStore: 'eve-atelier:asset-store',
        semanticStore: null,
      },
      createdAt: this.#now(),
    });
    const session = {
      schema: 'eve-atelier-aads-visual-session/v1',
      sessionId,
      projectId: normalizedIntent.projectId,
      documentId: normalizedIntent.documentId,
      goal: normalizedIntent.text,
      taskType: packet.taskType,
      intentId: normalizedIntent.intentId,
      packetId: packet.packetId,
      planId: plan.planId,
      workflowId: workflow.workflowId,
      contextSnapshotId: context.contextSnapshotId,
      initialArtState: {
        versionId: art.currentVersion.versionId,
        currentVersionId: art.currentVersion.versionId,
        documentRevision: art.documentRevision,
        componentGraphDigest: art.componentGraph.componentDigest,
        canvasRevision,
      },
      budget: structuredClone(budget),
      authority: structuredClone(authority),
      createdBy: structuredClone(normalizedIntent.submittedBy),
      createdAt: this.#now(),
    };
    const retained = this.#store.registerSessionBundle({
      intent: normalizedIntent,
      packet,
      plan,
      workflow,
      context,
      session,
    });
    return {
      ...retained,
      snapshot: this.#store.getSessionSnapshot(sessionId),
    };
  }

  run(sessionId) {
    return this.#runtime.run(sessionId);
  }

  submitHumanDecision(value) {
    return this.#runtime.submitHumanDecision(value);
  }

  projectContext({ contextSnapshotId, profile, projectionId }) {
    const retainedProfile = this.#store.registerWorkerProfile(profile);
    const projection = buildWorkerContextProjection({
      contextSnapshot: this.#store.getContextSnapshot(contextSnapshotId),
      profile: retainedProfile,
      projectionId,
      createdAt: this.#now(),
    });
    return this.#store.recordWorkerProjection(projection);
  }
}
