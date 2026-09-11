import { cloneVisualValue } from './contracts.js';

function required(value, methods, reason) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(reason);
  }
  return value;
}

function getPath(value, path) {
  let current = value;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      throw new Error(`rabcl_binding_path_missing:${path}`);
    }
    current = current[segment];
  }
  return cloneVisualValue(current);
}

function resolveValues(value, outputs) {
  if (Array.isArray(value)) return value.map(item => resolveValues(item, outputs));
  if (!value || typeof value !== 'object') return value;
  if (value.$ref === 'NODE_OUTPUT') {
    const output = outputs[value.nodeId];
    if (!output) throw new Error(`rabcl_binding_output_missing:${value.nodeId}`);
    return getPath(output, value.path);
  }
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, resolveValues(item, outputs)]));
}

function normalizeDecision(value) {
  if (value === 'RECOMPILE_REQUEST') return 'RECOMPILE';
  return value;
}

export class WorkbenchRabclAdapter {
  #bridge;
  #documentStore;
  #assetStore;
  #evaluators;

  constructor({ bridge, documentStore, assetStore, evaluators }) {
    this.#bridge = required(
      bridge,
      ['executeOperatorWithFallback', 'recordEvaluation', 'recordHumanReview', 'promoteCandidate'],
      'rabcl_workbench_bridge_required',
    );
    this.#documentStore = required(
      documentStore,
      ['getDocumentSnapshot', 'getVersion'],
      'rabcl_art_document_store_required',
    );
    this.#assetStore = required(assetStore, ['getPath', 'verifyAsset'], 'rabcl_asset_store_required');
    if (!evaluators || typeof evaluators !== 'object' || Array.isArray(evaluators)) {
      throw new TypeError('rabcl_evaluators_required');
    }
    this.#evaluators = { ...evaluators };
  }

  getArtSnapshot(documentId) {
    return this.#documentStore.getDocumentSnapshot(documentId);
  }

  #target(session, node, snapshot) {
    let versionId = session.initialArtState.versionId;
    if (node.targetBinding.kind === 'NODE_CANDIDATE') {
      const source = snapshot.outputs[node.targetBinding.nodeId];
      if (!source?.candidateVersionId) {
        throw new Error(`rabcl_candidate_binding_missing:${node.targetBinding.nodeId}`);
      }
      versionId = source.candidateVersionId;
    } else if (node.targetBinding.kind === 'LATEST_CANDIDATE') {
      const latest = Object.values(snapshot.outputs).reverse()
        .find(value => typeof value?.candidateVersionId === 'string');
      if (!latest) throw new Error('rabcl_latest_candidate_missing');
      versionId = latest.candidateVersionId;
    }
    return {
      schema: 'eve-atelier-art-operator-target/v1',
      targetId: `target:${session.sessionId}:${node.nodeId}:${snapshot.visits[node.nodeId] ?? 1}`,
      targetKind: 'DOCUMENT_VERSION',
      projectId: session.projectId,
      documentId: session.documentId,
      versionId,
      componentId: null,
      expectedCurrentVersionId: session.initialArtState.currentVersionId,
      expectedDocumentRevision: session.initialArtState.documentRevision,
      expectedCanvasRevision: session.initialArtState.canvasRevision,
    };
  }

  async executeOperator({ session, plan, node, snapshot, now }) {
    const visit = snapshot.visits[node.nodeId] ?? 1;
    const operationId = `operation:${session.sessionId}:${node.nodeId}:${visit}`;
    const commit = node.commit.kind === 'ASSET_ONLY'
      ? { kind: 'ASSET_ONLY' }
      : {
          kind: 'CANDIDATE_VERSION',
          versionId: `version:${session.sessionId}:${node.nodeId}:${visit}`,
          assetBindingId: `binding:${session.sessionId}:${node.nodeId}:${visit}`,
        };
    const result = await this.#bridge.executeOperatorWithFallback({
      operationId,
      packRef: cloneVisualValue(plan.packRef),
      operatorRef: cloneVisualValue(node.operatorRef),
      target: this.#target(session, node, snapshot),
      params: resolveValues(node.params, snapshot.outputs),
      providerPolicy: cloneVisualValue(node.providerPolicy),
      outputMediaType: node.output.mediaType,
      outputExtension: node.output.extension,
      commit,
      observedCanvasRevision: session.initialArtState.canvasRevision,
      fallbackContext: {
        alternativeProviderAvailable: node.fallback.some(item => item.decision === 'REBIND'),
        localRepairAvailable: node.fallback.some(item => item.decision === 'REPAIR'),
      },
      now,
    });
    if (result.status === 'FAILED') {
      return {
        status: 'FAILED',
        failureClass: result.failure.failureClass,
        decision: normalizeDecision(result.failure.decision),
        retryAuthorized: result.failure.retryAuthorized,
        evidenceRefs: [`evidence:${operationId}:failed`],
        usage: {
          providerCalls: 1,
          candidates: 0,
          costUnits: 0,
          latencyMs: 0,
        },
      };
    }
    const executed = result.result;
    const latencyMs = Math.max(
      0,
      Date.parse(executed.providerReceipt.finishedAt)
        - Date.parse(executed.providerReceipt.startedAt),
    );
    return {
      status: 'COMPLETED',
      asset: cloneVisualValue(executed.asset),
      candidateVersionId: executed.candidate?.version.versionId ?? null,
      executionId: executed.receipt.executionId,
      outputRole: node.commit.outputRole,
      evidenceRefs: [
        `evidence:${executed.receipt.executionId}`,
        `evidence:asset:${executed.asset.sha256}`,
      ],
      usage: {
        providerCalls: 1,
        candidates: executed.candidate === null ? 0 : 1,
        costUnits: 0,
        latencyMs,
      },
    };
  }

  async evaluate({ session, node, snapshot, now }) {
    const source = snapshot.outputs[node.inputBinding.nodeId];
    if (!source?.asset) throw new Error(`rabcl_evaluation_input_missing:${node.inputBinding.nodeId}`);
    this.#assetStore.verifyAsset(source.asset);
    const evaluator = this.#evaluators[node.evaluatorRef.id];
    if (typeof evaluator !== 'function') {
      throw new Error(`rabcl_evaluator_unavailable:${node.evaluatorRef.id}`);
    }
    const initialVersion = this.#documentStore.getVersion(session.initialArtState.versionId);
    this.#assetStore.verifyAsset(initialVersion.primaryAsset);
    const evidence = await evaluator({
      sourcePath: this.#assetStore.getPath(initialVersion.primaryAsset),
      outputPath: this.#assetStore.getPath(source.asset),
      sourceAsset: cloneVisualValue(initialVersion.primaryAsset),
      outputAsset: cloneVisualValue(source.asset),
      session: cloneVisualValue(session),
    });
    if (!evidence
        || !['ACCEPT', 'ACCEPT_WITH_WARNINGS', 'REPAIR', 'REJECT', 'UNVERIFIED']
          .includes(evidence.verdict)) {
      throw new Error('rabcl_evaluator_result_invalid');
    }
    const visit = snapshot.visits[node.nodeId] ?? 1;
    const evaluationId = `evaluation:${session.sessionId}:${node.nodeId}:${visit}`;
    const measurements = Object.fromEntries(Object.entries(evidence)
      .filter(([key]) => key !== 'verdict'));
    if (Object.keys(measurements).length === 0) measurements.observed = true;
    this.#bridge.recordEvaluation({
      schema: 'eve-atelier-art-evaluation/v1',
      evaluationId,
      documentId: session.documentId,
      versionId: source.candidateVersionId,
      verdict: evidence.verdict,
      evaluator: cloneVisualValue(node.evaluatorRef),
      measurements,
      evidenceRefs: [`evidence:${evaluationId}`],
      warnings: evidence.verdict === 'ACCEPT_WITH_WARNINGS' ? ['evaluator_warning'] : [],
      evaluatedAt: now(),
    });
    return {
      status: 'COMPLETED',
      evaluationId,
      candidateVersionId: source.candidateVersionId,
      verdict: evidence.verdict,
      evidenceRefs: [`evidence:${evaluationId}`],
    };
  }

  recordHumanReview({ session, node, snapshot, decision, reason, reviewer, now }) {
    const candidate = snapshot.outputs[node.candidateBinding.nodeId];
    const evaluation = snapshot.outputs[node.evaluationBinding.nodeId];
    if (!candidate?.candidateVersionId || !evaluation?.evaluationId) {
      throw new Error('rabcl_human_gate_binding_missing');
    }
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      throw new Error('rabcl_human_gate_decision_invalid');
    }
    const reviewId = `review:${session.sessionId}:${node.nodeId}:1`;
    this.#bridge.recordHumanReview({
      schema: 'eve-atelier-art-human-review/v1',
      reviewId,
      documentId: session.documentId,
      versionId: candidate.candidateVersionId,
      reviewer: cloneVisualValue(reviewer),
      disposition: decision,
      reason,
      evidenceRefs: [
        `evidence:${reviewId}`,
        ...evaluation.evidenceRefs,
      ],
      reviewedAt: now(),
    });
    return {
      reviewId,
      candidateVersionId: candidate.candidateVersionId,
      evaluationId: evaluation.evaluationId,
      disposition: decision,
      evidenceRefs: [`evidence:${reviewId}`],
    };
  }

  promote({ session, node, snapshot, actor, now }) {
    const candidate = snapshot.outputs[node.candidateBinding.nodeId];
    const evaluation = snapshot.outputs[node.evaluationBinding.nodeId];
    const review = node.reviewBinding === null ? null : snapshot.outputs[node.reviewBinding.nodeId];
    if (!candidate?.candidateVersionId || !evaluation?.evaluationId
        || (node.reviewBinding !== null && !review?.reviewId)) {
      throw new Error('rabcl_promotion_binding_missing');
    }
    this.#bridge.promoteCandidate({
      documentId: session.documentId,
      versionId: candidate.candidateVersionId,
      evaluationId: evaluation.evaluationId,
      reviewId: review?.reviewId ?? null,
      eventId: `current:${session.sessionId}:promote`,
      actor: cloneVisualValue(actor),
      evidenceRefs: [
        ...candidate.evidenceRefs,
        ...evaluation.evidenceRefs,
        ...(review?.evidenceRefs ?? []),
      ],
      expectedCurrentVersionId: session.initialArtState.currentVersionId,
      occurredAt: now(),
    });
    return {
      currentVersionId: candidate.candidateVersionId,
      evaluationId: evaluation.evaluationId,
      reviewId: review?.reviewId ?? null,
      evidenceRefs: [`evidence:current:${session.sessionId}`],
    };
  }
}
