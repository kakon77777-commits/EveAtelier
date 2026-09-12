function required(value, methods, reason) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(reason);
  }
  return value;
}

function humanActor(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 2
    && value.kind === 'HUMAN'
    && typeof value.id === 'string'
    && value.id.length > 0;
}

function operatorOutputs(snapshot) {
  return Object.entries(snapshot.outputs)
    .filter(([, output]) => typeof output?.executionId === 'string')
    .map(([nodeId, output]) => ({ nodeId, output }));
}

function unique(values) {
  return [...new Set(values)];
}

export class CompletedSessionKnowledgeIngestor {
  #knowledgeStore;
  #visualStore;
  #artStore;

  constructor({ knowledgeStore, visualIntelligenceStore, artDocumentStore }) {
    this.#knowledgeStore = required(
      knowledgeStore,
      ['registerKnowledgeBundle'],
      'knowledge_ingestor_store_required',
    );
    this.#visualStore = required(
      visualIntelligenceStore,
      ['getSessionSnapshot', 'getWorkflow'],
      'knowledge_ingestor_visual_store_required',
    );
    this.#artStore = required(
      artDocumentStore,
      [
        'getDocumentSnapshot', 'getVersion', 'getEvaluation', 'getHumanReview',
        'getExecutionReceipt',
      ],
      'knowledge_ingestor_art_store_required',
    );
  }

  ingest({
    sessionId,
    initialSource,
    acceptedSource,
    acceptedReferenceRoles,
    rightsActor,
    ingestedAt,
  } = {}) {
    const snapshot = this.#visualStore.getSessionSnapshot(sessionId);
    if (snapshot.status !== 'COMPLETED' || snapshot.terminalOutcome !== 'ACCEPTED') {
      throw new Error('knowledge_ingestor_session_not_accepted');
    }
    const session = snapshot.session;
    const workflow = this.#visualStore.getWorkflow(session.workflowId);
    const current = this.#artStore.getDocumentSnapshot(session.documentId);
    const promoted = snapshot.outputs.promote;
    const evaluated = snapshot.outputs.evaluate;
    if (!promoted?.currentVersionId
        || !evaluated?.evaluationId
        || current.currentVersion.versionId !== promoted.currentVersionId) {
      throw new Error('knowledge_ingestor_promotion_mismatch');
    }
    const initialVersion = this.#artStore.getVersion(session.initialArtState.versionId);
    const acceptedVersion = this.#artStore.getVersion(promoted.currentVersionId);
    if (initialVersion.documentId !== session.documentId
        || acceptedVersion.documentId !== session.documentId) {
      throw new Error('knowledge_ingestor_version_scope_mismatch');
    }
    for (const classification of [initialSource, acceptedSource]) {
      if (!classification
          || typeof classification !== 'object'
          || Array.isArray(classification)
          || !['RIGHTS_CLEAR', 'PRIVATE_RESEARCH', 'UNKNOWN'].includes(classification.rightsClass)
          || typeof classification.evidenceClass !== 'string'
          || !Array.isArray(classification.evidenceRefs)
          || typeof classification.canonicalLabel !== 'string'
          || classification.canonicalLabel.length === 0) {
        throw new Error('knowledge_ingestor_source_classification_invalid');
      }
    }
    if (acceptedSource.rightsClass !== initialSource.rightsClass) {
      throw new Error('knowledge_ingestor_rights_escalation_forbidden');
    }
    if (!Array.isArray(acceptedReferenceRoles)) {
      throw new TypeError('knowledge_ingestor_reference_roles_required');
    }
    if (!humanActor(rightsActor)) throw new Error('knowledge_ingestor_rights_actor_required');
    const initialSourceId = `source-identity:${sessionId}:initial`;
    const acceptedSourceId = `source-identity:${sessionId}:accepted`;
    const initialReferenceId = `reference-asset:${sessionId}:initial`;
    const acceptedReferenceId = `reference-asset:${sessionId}:accepted`;
    const knowledgeEvaluationId = `knowledge-evaluation:${evaluated.evaluationId}`;
    const sourceEvaluation = this.#artStore.getEvaluation(evaluated.evaluationId);
    if (sourceEvaluation.versionId !== acceptedVersion.versionId) {
      throw new Error('knowledge_ingestor_evaluation_version_mismatch');
    }
    const review = promoted.reviewId === null
      ? null
      : this.#artStore.getHumanReview(promoted.reviewId);
    if (review && (review.versionId !== acceptedVersion.versionId
      || !['APPROVE', 'ACCEPT_WITH_WARNINGS'].includes(review.disposition))) {
      throw new Error('knowledge_ingestor_review_mismatch');
    }
    const sourceIdentities = [{
      schema: 'eve-atelier-visual-source-identity/v1',
      sourceIdentityId: initialSourceId,
      projectId: session.projectId,
      sourceKind: initialSource.sourceKind ?? 'SYNTHETIC',
      canonicalLabel: initialSource.canonicalLabel,
      rightsClass: initialSource.rightsClass,
      evidenceClass: initialSource.evidenceClass,
      evidenceRefs: [...initialSource.evidenceRefs],
      provenance: { kind: 'HUMAN', id: rightsActor.id },
      createdAt: ingestedAt,
    }, {
      schema: 'eve-atelier-visual-source-identity/v1',
      sourceIdentityId: acceptedSourceId,
      projectId: session.projectId,
      sourceKind: 'DERIVED',
      canonicalLabel: acceptedSource.canonicalLabel,
      rightsClass: acceptedSource.rightsClass,
      evidenceClass: acceptedSource.evidenceClass,
      evidenceRefs: [...acceptedSource.evidenceRefs],
      provenance: { kind: 'HUMAN', id: rightsActor.id },
      createdAt: ingestedAt,
    }];
    const referenceAssets = [{
      schema: 'eve-atelier-reference-asset/v1',
      referenceAssetId: initialReferenceId,
      projectId: session.projectId,
      assetRef: initialVersion.primaryAsset,
      sourceIdentityId: initialSourceId,
      labels: ['source', session.taskType.toLowerCase()],
      status: 'ACTIVE',
      evidenceRefs: [...initialSource.evidenceRefs],
      provenance: { kind: 'IMPORT', id: `aads-session:${sessionId}` },
      createdAt: ingestedAt,
    }, {
      schema: 'eve-atelier-reference-asset/v1',
      referenceAssetId: acceptedReferenceId,
      projectId: session.projectId,
      assetRef: acceptedVersion.primaryAsset,
      sourceIdentityId: acceptedSourceId,
      labels: ['accepted', session.taskType.toLowerCase()],
      status: 'ACTIVE',
      evidenceRefs: unique([
        ...acceptedSource.evidenceRefs,
        ...sourceEvaluation.evidenceRefs,
        ...(review?.evidenceRefs ?? []),
      ]),
      provenance: { kind: 'RUNTIME', id: `aads-session:${sessionId}` },
      createdAt: ingestedAt,
    }];
    const referenceRoles = acceptedReferenceRoles.map((role, index) => ({
      schema: 'eve-atelier-reference-role/v1',
      roleBindingId: `reference-role:${sessionId}:${index + 1}`,
      projectId: session.projectId,
      referenceAssetId: acceptedReferenceId,
      role: role.role,
      allowedInfluence: [...role.allowedInfluence],
      scope: { kind: 'PROJECT_LOCAL', projectId: session.projectId, taskId: null },
      evidenceRefs: unique([
        ...sourceEvaluation.evidenceRefs,
        ...(review?.evidenceRefs ?? []),
      ]),
      provenance: review
        ? { kind: 'HUMAN', id: review.reviewer.id }
        : { kind: 'RUNTIME', id: `aads-session:${sessionId}` },
      createdAt: ingestedAt,
    }));
    const artifactEvaluations = [{
      schema: 'eve-atelier-artifact-evaluation/v1',
      knowledgeEvaluationId,
      projectId: session.projectId,
      assetRef: acceptedVersion.primaryAsset,
      documentId: session.documentId,
      versionId: acceptedVersion.versionId,
      sourceEvaluationId: sourceEvaluation.evaluationId,
      verdict: sourceEvaluation.verdict,
      evaluator: sourceEvaluation.evaluator,
      dimensionResults: sourceEvaluation.measurements,
      evidenceClass: 'CONTRACT_TESTED',
      evidenceRefs: unique(sourceEvaluation.evidenceRefs),
      provenance: { kind: 'IMPORT', id: 'eve-atelier:art-document-store' },
      observedAt: ingestedAt,
    }];
    const preferences = review ? [{
      schema: 'eve-atelier-preference-event/v1',
      preferenceId: `preference:${review.reviewId}`,
      projectId: session.projectId,
      observer: review.reviewer,
      subjectReferenceAssetId: acceptedReferenceId,
      comparisonReferenceAssetId: null,
      stance: 'LIKE',
      dimensions: ['IDENTITY', 'ALPHA', 'EDGE'],
      reason: review.reason,
      scope: { kind: 'PROJECT_LOCAL', projectId: session.projectId, taskId: session.sessionId },
      evidenceClass: 'HUMAN_OBSERVED',
      evidenceRefs: unique(review.evidenceRefs),
      observedAt: ingestedAt,
    }] : [];
    const providerEvidence = operatorOutputs(snapshot).map(({ nodeId, output }) => {
      const receipt = this.#artStore.getExecutionReceipt(output.executionId);
      const provider = receipt.providerReceipt ?? receipt;
      return {
        schema: 'eve-atelier-provider-capability-evidence/v1',
        providerEvidenceId: `provider-evidence:${output.executionId}`,
        projectId: session.projectId,
        sourceExecutionId: output.executionId,
        providerRef: provider.providerRef,
        operatorRef: provider.operatorRef,
        outcome: 'SUCCESS',
        qualitySignals: {
          acceptedDownstream: 1,
          reproducible: provider.reproducibility === 'exact' ? 1 : 0,
          outputCount: provider.outputArtifacts.length,
        },
        contextTags: [session.taskType, `node:${nodeId}`],
        evidenceClass: 'CONTRACT_TESTED',
        evidenceRefs: unique(output.evidenceRefs),
        provenance: { kind: 'RUNTIME', id: 'eve-atelier:workbench' },
        observedAt: ingestedAt,
      };
    });
    const workflowExperiences = [{
      schema: 'eve-atelier-workflow-experience/v1',
      workflowExperienceId: `workflow-experience:${sessionId}`,
      projectId: session.projectId,
      sessionId,
      sessionDigest: snapshot.lastEventDigest,
      workflowId: session.workflowId,
      taskType: session.taskType,
      outcome: 'ACCEPTED',
      operatorRefs: workflow.nodes.filter(node => node.kind === 'OPERATOR')
        .map(node => node.operatorRef),
      providerEvidenceRefs: providerEvidence.map(item => item.providerEvidenceId),
      artifactEvaluationRefs: [knowledgeEvaluationId],
      preferenceRefs: preferences.map(item => item.preferenceId),
      failureModeRefs: [],
      budgetUse: snapshot.usage,
      evidenceClass: 'CONTRACT_TESTED',
      evidenceRefs: unique([
        `evidence:aads-session:${snapshot.lastEventDigest}`,
        ...sourceEvaluation.evidenceRefs,
      ]),
      provenance: { kind: 'RUNTIME', id: 'eve-atelier:aads-runtime' },
      occurredAt: ingestedAt,
    }];
    const semanticRelations = [{
      schema: 'eve-atelier-semantic-relation/v1',
      relationId: `semantic-relation:${sessionId}:derived-from`,
      projectId: session.projectId,
      layer: 'ARTIFACT',
      subject: { kind: 'REFERENCE_ASSET', id: acceptedReferenceId },
      predicate: 'DERIVED_FROM',
      object: { kind: 'REFERENCE_ASSET', id: initialReferenceId },
      confidence: 1,
      observerRef: null,
      evidenceClass: 'CONTRACT_TESTED',
      evidenceRefs: [`evidence:aads-session:${snapshot.lastEventDigest}`],
      provenance: { kind: 'RUNTIME', id: 'eve-atelier:aads-runtime' },
      createdAt: ingestedAt,
    }];
    const retained = this.#knowledgeStore.registerKnowledgeBundle({
      sourceIdentities,
      referenceAssets,
      referenceRoles,
      artifactEvaluations,
      preferences,
      providerEvidence,
      workflowExperiences,
      semanticRelations,
    });
    return {
      sessionId,
      initialReferenceId,
      acceptedReferenceId,
      knowledgeEvaluationId,
      preferenceIds: preferences.map(item => item.preferenceId),
      providerEvidenceIds: providerEvidence.map(item => item.providerEvidenceId),
      workflowExperienceId: workflowExperiences[0].workflowExperienceId,
      retained,
    };
  }
}
