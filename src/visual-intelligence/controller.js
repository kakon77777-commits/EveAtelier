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
  #knowledgeStore;

  constructor({
    store,
    operatorStore,
    adapter,
    knowledgeStore = null,
    now = () => new Date().toISOString(),
  }) {
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
    this.#knowledgeStore = knowledgeStore === null
      ? null
      : required(knowledgeStore, ['getRetrievalContext'], 'aads_knowledge_store_invalid');
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
    retrievalContextRefs = [],
  }) {
    const normalizedIntent = normalizeVisualValue(intent, 'aads_visual_intent_json_value_invalid');
    const intentValidation = validateVisualIntent(normalizedIntent);
    if (!intentValidation.ok) throw new Error(intentValidation.reason);
    const art = this.#adapter.getArtSnapshot(normalizedIntent.documentId);
    const localOnlyReference = normalizedIntent.hardConstraints.some(item => (
      item.dimension === 'PRIVACY' && item.requirement.startsWith('LOCAL_ONLY_REFERENCE:')
    ));
    if (localOnlyReference
        && (providerPolicy.allowedPrivacy.length !== 1
          || providerPolicy.allowedPrivacy[0] !== 'LOCAL')) {
      throw new Error('aads_private_reference_requires_local_provider');
    }
    if (!Array.isArray(retrievalContextRefs)
        || new Set(retrievalContextRefs).size !== retrievalContextRefs.length
        || retrievalContextRefs.some(item => typeof item !== 'string' || item.length === 0)) {
      throw new TypeError('aads_retrieval_context_refs_invalid');
    }
    if (retrievalContextRefs.length > 0 && this.#knowledgeStore === null) {
      throw new Error('aads_knowledge_store_required_for_retrieval');
    }
    for (const id of retrievalContextRefs) {
      const retrieval = this.#knowledgeStore.getRetrievalContext(id);
      if (retrieval.projectId !== normalizedIntent.projectId) {
        throw new Error('aads_retrieval_context_project_mismatch');
      }
      if (retrieval.query.allowedRightsClasses.includes('UNKNOWN')
          && (providerPolicy.allowedPrivacy.length !== 1
            || providerPolicy.allowedPrivacy[0] !== 'LOCAL')) {
        throw new Error('aads_unknown_rights_requires_local_provider');
      }
      if (retrieval.query.allowedRightsClasses.includes('PRIVATE_RESEARCH')
          && providerPolicy.allowedPrivacy.includes('REMOTE_PUBLIC')) {
        throw new Error('aads_private_retrieval_remote_public_forbidden');
      }
    }
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
      retrievalContextRefs,
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
    const contextInput = {
      schema: retrievalContextRefs.length > 0
        ? 'eve-atelier-project-context-snapshot/v2'
        : 'eve-atelier-project-context-snapshot/v1',
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
      evidenceRefs: [
        ...evidenceRefs,
        ...retrievalContextRefs.map(id => `evidence:retrieval:${id}`),
      ],
      sourceAuthorities: {
        operatorRegistry: 'eve-atelier:operator-registry',
        artDocumentStore: 'eve-atelier:art-document-store',
        assetStore: 'eve-atelier:asset-store',
        semanticStore: retrievalContextRefs.length > 0 ? 'eve-atelier:sedb-visual' : null,
      },
      createdAt: this.#now(),
    };
    if (retrievalContextRefs.length > 0) {
      contextInput.retrievalContextRefs = [...retrievalContextRefs];
    }
    const context = buildProjectContextSnapshot(contextInput);
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
