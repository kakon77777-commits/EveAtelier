import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../operator-runtime/canonical.js';
import {
  cloneKnowledgeValue,
  normalizeKnowledgeValue,
  sameKnowledgeValue,
  validateArtifactEvaluation,
  validateAtlasSnapshot,
  validateConceptStatusEvent,
  validateFailureMode,
  validateFeatureObservation,
  validatePreferenceEvent,
  validateProviderCapabilityEvidence,
  validateReferenceAsset,
  validateReferenceRole,
  validateRetrievalContext,
  validateSemanticRelation,
  validateSourceIdentity,
  validateStyleObservation,
  validateVisualConcept,
  validateWorkflowExperience,
} from './contracts.js';
import {
  buildAtlasSnapshotFromRecords,
  buildRetrievalContextFromAtlas,
} from './style-atlas-core.js';

function immutableTriggers(table, conflicts) {
  return `
    CREATE TRIGGER IF NOT EXISTS ${table}_no_update
    BEFORE UPDATE ON ${table}
    BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
    CREATE TRIGGER IF NOT EXISTS ${table}_no_delete
    BEFORE DELETE ON ${table}
    BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;
    DROP TRIGGER IF EXISTS ${table}_no_replace;
    CREATE TRIGGER ${table}_no_replace
    BEFORE INSERT ON ${table}
    WHEN EXISTS (SELECT 1 FROM ${table} WHERE rowid = NEW.rowid OR (${conflicts}))
    BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
  `;
}

function required(value, methods, reason) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(reason);
  }
  return value;
}

const metadata = Object.freeze({
  SOURCE_IDENTITY: {
    table: 'vk_source_identities', idColumn: 'source_identity_id', idProp: 'sourceIdentityId',
    validator: validateSourceIdentity,
  },
  REFERENCE_ASSET: {
    table: 'vk_reference_assets', idColumn: 'reference_asset_id', idProp: 'referenceAssetId',
    validator: validateReferenceAsset,
  },
  REFERENCE_ROLE: {
    table: 'vk_reference_roles', idColumn: 'role_binding_id', idProp: 'roleBindingId',
    validator: validateReferenceRole,
  },
  VISUAL_CONCEPT: {
    table: 'vk_visual_concepts', idColumn: 'concept_id', idProp: 'conceptId',
    validator: validateVisualConcept,
  },
  STYLE_OBSERVATION: {
    table: 'vk_style_observations', idColumn: 'observation_id', idProp: 'observationId',
    validator: validateStyleObservation,
  },
  PREFERENCE_EVENT: {
    table: 'vk_preferences', idColumn: 'preference_id', idProp: 'preferenceId',
    validator: validatePreferenceEvent,
  },
  ARTIFACT_EVALUATION: {
    table: 'vk_artifact_evaluations', idColumn: 'knowledge_evaluation_id',
    idProp: 'knowledgeEvaluationId', validator: validateArtifactEvaluation,
  },
  FAILURE_MODE: {
    table: 'vk_failure_modes', idColumn: 'failure_mode_id', idProp: 'failureModeId',
    validator: validateFailureMode,
  },
  PROVIDER_EVIDENCE: {
    table: 'vk_provider_evidence', idColumn: 'provider_evidence_id', idProp: 'providerEvidenceId',
    validator: validateProviderCapabilityEvidence,
  },
  WORKFLOW_EXPERIENCE: {
    table: 'vk_workflow_experiences', idColumn: 'workflow_experience_id',
    idProp: 'workflowExperienceId', validator: validateWorkflowExperience,
  },
  SEMANTIC_RELATION: {
    table: 'vk_semantic_relations', idColumn: 'relation_id', idProp: 'relationId',
    validator: validateSemanticRelation,
  },
  FEATURE_OBSERVATION: {
    table: 'vk_feature_observations', idColumn: 'feature_observation_id',
    idProp: 'featureObservationId', validator: validateFeatureObservation,
  },
});

const exportKeys = Object.freeze({
  SOURCE_IDENTITY: 'sourceIdentities',
  REFERENCE_ASSET: 'referenceAssets',
  REFERENCE_ROLE: 'referenceRoles',
  VISUAL_CONCEPT: 'visualConcepts',
  STYLE_OBSERVATION: 'styleObservations',
  PREFERENCE_EVENT: 'preferences',
  ARTIFACT_EVALUATION: 'artifactEvaluations',
  FAILURE_MODE: 'failureModes',
  PROVIDER_EVIDENCE: 'providerEvidence',
  WORKFLOW_EXPERIENCE: 'workflowExperiences',
  SEMANTIC_RELATION: 'semanticRelations',
  FEATURE_OBSERVATION: 'featureObservations',
});

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function scopeKey(value) {
  return `${value.scope.projectId}:${value.scope.taskId ?? '*'}`;
}

function extractorKey(value) {
  return [
    value.projectId,
    value.referenceAssetId,
    value.extractor.id,
    value.extractor.version,
    value.extractor.spaceId,
  ].join(':');
}

export class VisualKnowledgeStore {
  #database;
  #assetStore;
  #artDocumentStore;
  #visualIntelligenceStore;
  #transactionDepth = 0;

  constructor({
    path = ':memory:',
    assetStore,
    artDocumentStore,
    visualIntelligenceStore,
  }) {
    this.#assetStore = required(assetStore, ['verifyAsset'], 'visual_knowledge_asset_store_required');
    this.#artDocumentStore = required(
      artDocumentStore,
      [
        'getDocument', 'getVersion', 'getLayer', 'getMask', 'getSelection',
        'getRegion', 'getStructureBinding', 'getFieldBinding', 'getEvaluation',
        'getExecutionReceipt',
      ],
      'visual_knowledge_art_store_required',
    );
    this.#visualIntelligenceStore = required(
      visualIntelligenceStore,
      ['getSessionSnapshot', 'getWorkflow'],
      'visual_knowledge_intelligence_store_required',
    );
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS vk_source_identities (
        source_identity_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_reference_assets (
        reference_asset_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        source_identity_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (source_identity_id) REFERENCES vk_source_identities(source_identity_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_reference_roles (
        role_binding_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        reference_asset_id TEXT NOT NULL,
        role TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(reference_asset_id, role, scope_key),
        FOREIGN KEY (reference_asset_id) REFERENCES vk_reference_assets(reference_asset_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_visual_concepts (
        concept_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        concept_key TEXT NOT NULL,
        concept_version TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(project_id, concept_key, concept_version)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_concept_status_events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        status_event_id TEXT NOT NULL UNIQUE,
        concept_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (concept_id) REFERENCES vk_visual_concepts(concept_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_style_observations (
        observation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        subject_reference_asset_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (subject_reference_asset_id) REFERENCES vk_reference_assets(reference_asset_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_preferences (
        preference_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        subject_reference_asset_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (subject_reference_asset_id) REFERENCES vk_reference_assets(reference_asset_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_artifact_evaluations (
        knowledge_evaluation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        source_evaluation_id TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_failure_modes (
        failure_mode_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        failure_code TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(project_id, failure_code)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_provider_evidence (
        provider_evidence_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_execution_id TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_workflow_experiences (
        workflow_experience_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_semantic_relations (
        relation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        relation_layer TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_kind TEXT NOT NULL,
        object_id TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_feature_observations (
        feature_observation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        reference_asset_id TEXT NOT NULL,
        extractor_key TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL,
        FOREIGN KEY (reference_asset_id) REFERENCES vk_reference_assets(reference_asset_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_atlas_snapshots (
        atlas_snapshot_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        knowledge_revision INTEGER NOT NULL,
        source_digest TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_retrieval_contexts (
        retrieval_context_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        knowledge_revision INTEGER NOT NULL,
        atlas_snapshot_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (atlas_snapshot_id) REFERENCES vk_atlas_snapshots(atlas_snapshot_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vk_ledger (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_event_id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        record_kind TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_digest TEXT NOT NULL,
        affects_revision INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(record_kind, record_id)
      ) STRICT;

      ${immutableTriggers('vk_source_identities', 'source_identity_id = NEW.source_identity_id')}
      ${immutableTriggers('vk_reference_assets', 'reference_asset_id = NEW.reference_asset_id')}
      ${immutableTriggers('vk_reference_roles', 'role_binding_id = NEW.role_binding_id OR (reference_asset_id = NEW.reference_asset_id AND role = NEW.role AND scope_key = NEW.scope_key)')}
      ${immutableTriggers('vk_visual_concepts', 'concept_id = NEW.concept_id OR (project_id = NEW.project_id AND concept_key = NEW.concept_key AND concept_version = NEW.concept_version)')}
      ${immutableTriggers('vk_concept_status_events', 'status_event_id = NEW.status_event_id OR event_sequence = NEW.event_sequence')}
      ${immutableTriggers('vk_style_observations', 'observation_id = NEW.observation_id')}
      ${immutableTriggers('vk_preferences', 'preference_id = NEW.preference_id')}
      ${immutableTriggers('vk_artifact_evaluations', 'knowledge_evaluation_id = NEW.knowledge_evaluation_id OR source_evaluation_id = NEW.source_evaluation_id')}
      ${immutableTriggers('vk_failure_modes', 'failure_mode_id = NEW.failure_mode_id OR (project_id = NEW.project_id AND failure_code = NEW.failure_code)')}
      ${immutableTriggers('vk_provider_evidence', 'provider_evidence_id = NEW.provider_evidence_id OR source_execution_id = NEW.source_execution_id')}
      ${immutableTriggers('vk_workflow_experiences', 'workflow_experience_id = NEW.workflow_experience_id OR session_id = NEW.session_id')}
      ${immutableTriggers('vk_semantic_relations', 'relation_id = NEW.relation_id')}
      ${immutableTriggers('vk_feature_observations', 'feature_observation_id = NEW.feature_observation_id OR extractor_key = NEW.extractor_key')}
      ${immutableTriggers('vk_atlas_snapshots', 'atlas_snapshot_id = NEW.atlas_snapshot_id')}
      ${immutableTriggers('vk_retrieval_contexts', 'retrieval_context_id = NEW.retrieval_context_id')}
      ${immutableTriggers('vk_ledger', 'ledger_event_id = NEW.ledger_event_id OR (record_kind = NEW.record_kind AND record_id = NEW.record_id) OR event_sequence = NEW.event_sequence')}
    `);
  }

  #transaction(action) {
    if (this.#transactionDepth > 0) return action();
    this.#database.exec('BEGIN IMMEDIATE');
    this.#transactionDepth += 1;
    try {
      const result = action();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  #append({
    kind,
    table,
    idColumn,
    id,
    projectId,
    record,
    columns,
    values,
    affectsRevision = true,
    conflict,
  }) {
    const existing = this.#database.prepare(`
      SELECT record_json FROM ${table} WHERE ${idColumn} = ?
    `).get(id);
    if (existing) {
      const retained = JSON.parse(existing.record_json);
      if (!sameKnowledgeValue(retained, record)) throw new Error(conflict);
      const ledger = this.#database.prepare(`
        SELECT project_id, record_digest, affects_revision FROM vk_ledger
        WHERE record_kind = ? AND record_id = ?
      `).get(kind, id);
      if (!ledger
          || ledger.project_id !== projectId
          || ledger.record_digest !== digest(retained)
          || Boolean(ledger.affects_revision) !== affectsRevision) {
        throw new Error('visual_knowledge_ledger_binding_invalid');
      }
      return retained;
    }
    this.#database.prepare(`
      INSERT INTO ${table} (${columns.join(', ')}, record_json)
      VALUES (${columns.map(() => '?').join(', ')}, ?)
    `).run(...values, canonicalJson(record));
    const recordDigest = digest(record);
    const ledger = {
      schema: 'eve-atelier-visual-knowledge-ledger-event/v1',
      ledgerEventId: `knowledge-ledger:${kind}:${id}`,
      projectId,
      recordKind: kind,
      recordId: id,
      recordDigest,
      affectsRevision,
      occurredAt: record.createdAt ?? record.observedAt ?? record.occurredAt,
    };
    this.#database.prepare(`
      INSERT INTO vk_ledger (
        ledger_event_id, project_id, record_kind, record_id, record_digest,
        affects_revision, record_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      ledger.ledgerEventId,
      projectId,
      kind,
      id,
      recordDigest,
      affectsRevision ? 1 : 0,
      canonicalJson(ledger),
    );
    return cloneKnowledgeValue(record);
  }

  #register(kind, raw, extra) {
    const meta = metadata[kind];
    const value = normalizeKnowledgeValue(raw, `visual_knowledge_${kind.toLowerCase()}_json_invalid`);
    const validation = meta.validator(value);
    if (!validation.ok) throw new Error(validation.reason);
    return this.#transaction(() => this.#append({
      kind,
      table: meta.table,
      idColumn: meta.idColumn,
      id: value[meta.idProp],
      projectId: value.projectId,
      record: value,
      ...extra(value),
      conflict: `visual_knowledge_${kind.toLowerCase()}_id_conflict`,
    }));
  }

  registerSourceIdentity(raw) {
    return this.#register('SOURCE_IDENTITY', raw, value => ({
      columns: ['source_identity_id', 'project_id'],
      values: [value.sourceIdentityId, value.projectId],
    }));
  }

  registerReferenceAsset(raw) {
    return this.#register('REFERENCE_ASSET', raw, value => {
      this.#assetStore.verifyAsset(value.assetRef);
      const source = this.getRecord('SOURCE_IDENTITY', value.sourceIdentityId);
      if (source.projectId !== value.projectId) throw new Error('reference_asset_source_scope_mismatch');
      return {
        columns: ['reference_asset_id', 'project_id', 'asset_id', 'source_identity_id'],
        values: [
          value.referenceAssetId, value.projectId, value.assetRef.assetId,
          value.sourceIdentityId,
        ],
      };
    });
  }

  registerReferenceRole(raw) {
    return this.#register('REFERENCE_ROLE', raw, value => {
      const reference = this.getRecord('REFERENCE_ASSET', value.referenceAssetId);
      if (reference.projectId !== value.projectId) throw new Error('reference_role_scope_mismatch');
      return {
        columns: [
          'role_binding_id', 'project_id', 'reference_asset_id', 'role', 'scope_key',
        ],
        values: [
          value.roleBindingId, value.projectId, value.referenceAssetId,
          value.role, scopeKey(value),
        ],
      };
    });
  }

  registerVisualConcept(raw) {
    return this.#register('VISUAL_CONCEPT', raw, value => ({
      columns: ['concept_id', 'project_id', 'concept_key', 'concept_version'],
      values: [value.conceptId, value.projectId, value.conceptKey, value.version],
    }));
  }

  appendConceptStatusEvent(raw) {
    const value = normalizeKnowledgeValue(raw, 'visual_concept_status_event_json_invalid');
    const validation = validateConceptStatusEvent(value);
    if (!validation.ok) throw new Error(validation.reason);
    return this.#transaction(() => {
      const concept = this.getRecord('VISUAL_CONCEPT', value.conceptId);
      if (concept.projectId !== value.projectId) throw new Error('visual_concept_status_scope_mismatch');
      const current = this.getConceptStatus(value.conceptId);
      if (current !== value.fromStatus) {
        throw new Error(`visual_concept_status_stale:${current}`);
      }
      const latest = this.#database.prepare(`
        SELECT record_json FROM vk_concept_status_events
        WHERE concept_id = ? ORDER BY event_sequence DESC LIMIT 1
      `).get(value.conceptId);
      const previousAt = latest
        ? JSON.parse(latest.record_json).occurredAt
        : concept.createdAt;
      if (Date.parse(value.occurredAt) <= Date.parse(previousAt)) {
        throw new Error('visual_concept_status_time_not_monotonic');
      }
      return this.#append({
        kind: 'CONCEPT_STATUS_EVENT',
        table: 'vk_concept_status_events',
        idColumn: 'status_event_id',
        id: value.statusEventId,
        projectId: value.projectId,
        record: value,
        columns: [
          'status_event_id', 'concept_id', 'project_id', 'from_status', 'to_status',
        ],
        values: [
          value.statusEventId, value.conceptId, value.projectId,
          value.fromStatus, value.toStatus,
        ],
        conflict: 'visual_concept_status_event_id_conflict',
      });
    });
  }

  getConceptStatus(conceptId) {
    const concept = this.getRecord('VISUAL_CONCEPT', conceptId);
    const row = this.#database.prepare(`
      SELECT to_status FROM vk_concept_status_events
      WHERE concept_id = ? ORDER BY event_sequence DESC LIMIT 1
    `).get(conceptId);
    return row?.to_status ?? concept.initialStatus;
  }

  registerStyleObservation(raw) {
    return this.#register('STYLE_OBSERVATION', raw, value => {
      this.#assertReferenceScope(value.subjectReferenceAssetId, value.projectId);
      if (value.comparisonReferenceAssetId !== null) {
        this.#assertReferenceScope(value.comparisonReferenceAssetId, value.projectId);
      }
      return {
        columns: ['observation_id', 'project_id', 'subject_reference_asset_id'],
        values: [value.observationId, value.projectId, value.subjectReferenceAssetId],
      };
    });
  }

  registerPreference(raw) {
    return this.#register('PREFERENCE_EVENT', raw, value => {
      this.#assertReferenceScope(value.subjectReferenceAssetId, value.projectId);
      if (value.comparisonReferenceAssetId !== null) {
        this.#assertReferenceScope(value.comparisonReferenceAssetId, value.projectId);
      }
      return {
        columns: ['preference_id', 'project_id', 'subject_reference_asset_id'],
        values: [value.preferenceId, value.projectId, value.subjectReferenceAssetId],
      };
    });
  }

  registerArtifactEvaluation(raw) {
    return this.#register('ARTIFACT_EVALUATION', raw, value => {
      this.#assetStore.verifyAsset(value.assetRef);
      const version = this.#artDocumentStore.getVersion(value.versionId);
      const document = this.#artDocumentStore.getDocument(value.documentId);
      const source = this.#artDocumentStore.getEvaluation(value.sourceEvaluationId);
      if (document.projectId !== value.projectId
          || version.documentId !== value.documentId
          || !sameKnowledgeValue(version.primaryAsset, value.assetRef)
          || source.documentId !== value.documentId
          || source.versionId !== value.versionId
          || source.verdict !== value.verdict
          || !sameKnowledgeValue(source.evaluator, value.evaluator)
          || !sameKnowledgeValue(source.measurements, value.dimensionResults)
          || source.evidenceRefs.some(ref => !value.evidenceRefs.includes(ref))) {
        throw new Error('artifact_evaluation_source_mismatch');
      }
      return {
        columns: [
          'knowledge_evaluation_id', 'project_id', 'asset_id', 'source_evaluation_id',
        ],
        values: [
          value.knowledgeEvaluationId, value.projectId, value.assetRef.assetId,
          value.sourceEvaluationId,
        ],
      };
    });
  }

  registerFailureMode(raw) {
    return this.#register('FAILURE_MODE', raw, value => {
      for (const id of value.referenceAssetIds) this.#assertReferenceScope(id, value.projectId);
      return {
        columns: ['failure_mode_id', 'project_id', 'failure_code'],
        values: [value.failureModeId, value.projectId, value.code],
      };
    });
  }

  registerProviderEvidence(raw) {
    return this.#register('PROVIDER_EVIDENCE', raw, value => {
      const receipt = this.#artDocumentStore.getExecutionReceipt(value.sourceExecutionId);
      const provider = receipt.providerReceipt ?? receipt;
      if (value.outcome !== 'SUCCESS'
          || this.#providerReceiptProject(provider) !== value.projectId
          || provider.providerRef.providerId !== value.providerRef.providerId
          || provider.providerRef.providerVersion !== value.providerRef.providerVersion
          || !sameKnowledgeValue(provider.operatorRef, value.operatorRef)
          || provider.status !== 'completed') {
        throw new Error('provider_evidence_execution_mismatch');
      }
      return {
        columns: ['provider_evidence_id', 'project_id', 'source_execution_id'],
        values: [value.providerEvidenceId, value.projectId, value.sourceExecutionId],
      };
    });
  }

  #providerReceiptProject(receipt) {
    const kind = receipt.target.kind;
    const id = receipt.target.id;
    let documentId;
    if (kind === 'art.document') {
      try {
        documentId = this.#artDocumentStore.getDocument(id).documentId;
      } catch {
        documentId = this.#artDocumentStore.getVersion(id).documentId;
      }
    } else if (kind === 'art.document_version') {
      documentId = this.#artDocumentStore.getVersion(id).documentId;
    } else {
      const component = {
        'art.layer': () => this.#artDocumentStore.getLayer(id),
        'art.mask': () => this.#artDocumentStore.getMask(id),
        'art.selection': () => this.#artDocumentStore.getSelection(id),
        'art.region': () => this.#artDocumentStore.getRegion(id),
        'art.structure': () => this.#artDocumentStore.getStructureBinding(id),
        'art.field': () => this.#artDocumentStore.getFieldBinding(id),
      }[kind]?.();
      if (!component) throw new Error('provider_evidence_target_kind_unsupported');
      documentId = component.documentId;
    }
    return this.#artDocumentStore.getDocument(documentId).projectId;
  }

  registerWorkflowExperience(raw) {
    return this.#register('WORKFLOW_EXPERIENCE', raw, value => {
      const session = this.#visualIntelligenceStore.getSessionSnapshot(value.sessionId);
      const workflow = this.#visualIntelligenceStore.getWorkflow(session.session.workflowId);
      const exactOperators = workflow.nodes.filter(node => node.kind === 'OPERATOR')
        .map(node => node.operatorRef);
      const expectedOutcome = session.terminalOutcome === 'ACCEPTED'
        ? 'ACCEPTED'
        : session.terminalOutcome === 'REJECTED'
          ? 'REJECTED'
          : session.terminalOutcome === 'FAILED'
            ? 'FAILED'
            : 'UNCERTAIN';
      if (session.session.projectId !== value.projectId
          || !['COMPLETED', 'STOPPED', 'FAILED'].includes(session.status)
          || expectedOutcome !== value.outcome
          || session.lastEventDigest !== value.sessionDigest
          || session.session.workflowId !== value.workflowId
          || session.session.taskType !== value.taskType
          || !sameKnowledgeValue(exactOperators, value.operatorRefs)
          || !sameKnowledgeValue(session.usage, value.budgetUse)) {
        throw new Error('workflow_experience_session_mismatch');
      }
      for (const id of value.providerEvidenceRefs) this.#assertKindScope('PROVIDER_EVIDENCE', id, value.projectId);
      for (const id of value.artifactEvaluationRefs) this.#assertKindScope('ARTIFACT_EVALUATION', id, value.projectId);
      for (const id of value.preferenceRefs) this.#assertKindScope('PREFERENCE_EVENT', id, value.projectId);
      for (const id of value.failureModeRefs) this.#assertKindScope('FAILURE_MODE', id, value.projectId);
      return {
        columns: ['workflow_experience_id', 'project_id', 'session_id'],
        values: [value.workflowExperienceId, value.projectId, value.sessionId],
      };
    });
  }

  registerSemanticRelation(raw) {
    return this.#register('SEMANTIC_RELATION', raw, value => {
      this.#assertKindScope(value.subject.kind, value.subject.id, value.projectId);
      this.#assertKindScope(value.object.kind, value.object.id, value.projectId);
      return {
        columns: [
          'relation_id', 'project_id', 'relation_layer', 'subject_kind',
          'subject_id', 'predicate', 'object_kind', 'object_id',
        ],
        values: [
          value.relationId, value.projectId, value.layer, value.subject.kind,
          value.subject.id, value.predicate, value.object.kind, value.object.id,
        ],
      };
    });
  }

  registerFeatureObservation(raw) {
    return this.#register('FEATURE_OBSERVATION', raw, value => {
      this.#assertReferenceScope(value.referenceAssetId, value.projectId);
      return {
        columns: [
          'feature_observation_id', 'project_id', 'reference_asset_id', 'extractor_key',
        ],
        values: [
          value.featureObservationId, value.projectId, value.referenceAssetId,
          extractorKey(value),
        ],
      };
    });
  }

  #assertReferenceScope(id, projectId) {
    this.#assertKindScope('REFERENCE_ASSET', id, projectId);
  }

  #assertKindScope(kind, id, projectId) {
    const record = this.getRecord(kind, id);
    if (record.projectId !== projectId) throw new Error('visual_knowledge_record_scope_mismatch');
  }

  getRecord(kind, id) {
    const meta = metadata[kind];
    if (!meta) throw new Error(`visual_knowledge_kind_unsupported:${kind}`);
    const row = this.#database.prepare(`
      SELECT record_json FROM ${meta.table} WHERE ${meta.idColumn} = ?
    `).get(id);
    if (!row) throw new Error(`visual_knowledge_record_not_found:${kind}`);
    const value = JSON.parse(row.record_json);
    if (kind === 'REFERENCE_ASSET') this.#assetStore.verifyAsset(value.assetRef);
    if (kind === 'ARTIFACT_EVALUATION') this.#assetStore.verifyAsset(value.assetRef);
    return value;
  }

  listRecords(kind, projectId) {
    const meta = metadata[kind];
    if (!meta) throw new Error(`visual_knowledge_kind_unsupported:${kind}`);
    const values = this.#database.prepare(`
      SELECT record_json FROM ${meta.table} WHERE project_id = ? ORDER BY rowid
    `).all(projectId).map(row => JSON.parse(row.record_json));
    for (const value of values) {
      if (kind === 'REFERENCE_ASSET') this.#assetStore.verifyAsset(value.assetRef);
      if (kind === 'ARTIFACT_EVALUATION') this.#assetStore.verifyAsset(value.assetRef);
    }
    return values;
  }

  listConceptStatusEvents(projectId) {
    return this.#database.prepare(`
      SELECT record_json FROM vk_concept_status_events
      WHERE project_id = ? ORDER BY event_sequence
    `).all(projectId).map(row => JSON.parse(row.record_json));
  }

  getProjectRevision(projectId) {
    return this.verifyProjectLedger(projectId).revision;
  }

  exportProjectRecords(projectId) {
    const result = {};
    for (const [kind, key] of Object.entries(exportKeys)) {
      result[key] = this.listRecords(kind, projectId);
    }
    result.conceptStatusEvents = this.listConceptStatusEvents(projectId);
    return result;
  }

  getProjectSourceDigest(projectId) {
    return digest(this.exportProjectRecords(projectId));
  }

  recordAtlasSnapshot(raw) {
    const value = normalizeKnowledgeValue(raw, 'style_atlas_snapshot_json_invalid');
    const validation = validateAtlasSnapshot(value);
    if (!validation.ok) throw new Error(validation.reason);
    return this.#transaction(() => {
      const records = this.exportProjectRecords(value.projectId);
      const currentRevision = this.getProjectRevision(value.projectId);
      const sourceDigest = digest(records);
      if (value.knowledgeRevision !== currentRevision || value.sourceDigest !== sourceDigest) {
        throw new Error('style_atlas_source_stale');
      }
      const expected = buildAtlasSnapshotFromRecords({
        records,
        projectId: value.projectId,
        atlasSnapshotId: value.atlasSnapshotId,
        knowledgeRevision: currentRevision,
        clusterThreshold: value.clusterThreshold,
        createdAt: value.createdAt,
      });
      if (!sameKnowledgeValue(value, expected)) throw new Error('style_atlas_snapshot_forged');
      return this.#append({
        kind: 'ATLAS_SNAPSHOT',
        table: 'vk_atlas_snapshots',
        idColumn: 'atlas_snapshot_id',
        id: value.atlasSnapshotId,
        projectId: value.projectId,
        record: value,
        columns: [
          'atlas_snapshot_id', 'project_id', 'knowledge_revision', 'source_digest',
        ],
        values: [
          value.atlasSnapshotId, value.projectId, value.knowledgeRevision, value.sourceDigest,
        ],
        affectsRevision: false,
        conflict: 'style_atlas_snapshot_id_conflict',
      });
    });
  }

  getAtlasSnapshot(id) {
    const row = this.#database.prepare(`
      SELECT record_json FROM vk_atlas_snapshots WHERE atlas_snapshot_id = ?
    `).get(id);
    if (!row) throw new Error('style_atlas_snapshot_not_found');
    const value = JSON.parse(row.record_json);
    for (const card of value.referenceCards) this.#assetStore.verifyAsset(card.assetRef);
    return value;
  }

  recordRetrievalContext(raw) {
    const value = normalizeKnowledgeValue(raw, 'visual_retrieval_context_json_invalid');
    const validation = validateRetrievalContext(value);
    if (!validation.ok) throw new Error(validation.reason);
    return this.#transaction(() => {
      const atlas = this.getAtlasSnapshot(value.atlasSnapshotId);
      const records = this.exportProjectRecords(value.projectId);
      if (atlas.projectId !== value.projectId
          || value.knowledgeRevision !== atlas.knowledgeRevision
          || value.atlasSourceDigest !== atlas.sourceDigest) {
        throw new Error('visual_retrieval_atlas_mismatch');
      }
      const expected = buildRetrievalContextFromAtlas({
        atlas,
        records,
        query: value.query,
        retrievalContextId: value.retrievalContextId,
        createdAt: value.createdAt,
      });
      if (!sameKnowledgeValue(value, expected)) throw new Error('visual_retrieval_context_forged');
      return this.#append({
        kind: 'RETRIEVAL_CONTEXT',
        table: 'vk_retrieval_contexts',
        idColumn: 'retrieval_context_id',
        id: value.retrievalContextId,
        projectId: value.projectId,
        record: value,
        columns: [
          'retrieval_context_id', 'project_id', 'knowledge_revision', 'atlas_snapshot_id',
        ],
        values: [
          value.retrievalContextId, value.projectId, value.knowledgeRevision,
          value.atlasSnapshotId,
        ],
        affectsRevision: false,
        conflict: 'visual_retrieval_context_id_conflict',
      });
    });
  }

  getRetrievalContext(id) {
    const row = this.#database.prepare(`
      SELECT record_json FROM vk_retrieval_contexts WHERE retrieval_context_id = ?
    `).get(id);
    if (!row) throw new Error('visual_retrieval_context_not_found');
    const value = JSON.parse(row.record_json);
    this.getAtlasSnapshot(value.atlasSnapshotId);
    for (const kind of Object.keys(exportKeys)) {
      const selectedKey = {
        REFERENCE_ASSET: 'referenceAssetIds',
        VISUAL_CONCEPT: 'conceptIds',
        STYLE_OBSERVATION: 'styleObservationIds',
        PREFERENCE_EVENT: 'preferenceIds',
        ARTIFACT_EVALUATION: 'artifactEvaluationIds',
        FAILURE_MODE: 'failureModeIds',
        PROVIDER_EVIDENCE: 'providerEvidenceIds',
        WORKFLOW_EXPERIENCE: 'workflowExperienceIds',
        SEMANTIC_RELATION: 'semanticRelationIds',
      }[kind];
      if (!selectedKey) continue;
      for (const recordId of value.selected[selectedKey]) this.getRecord(kind, recordId);
    }
    return value;
  }

  registerKnowledgeBundle(bundle = {}) {
    bundle = normalizeKnowledgeValue(bundle, 'visual_knowledge_bundle_json_invalid');
    const fields = [
      'sourceIdentities', 'referenceAssets', 'referenceRoles', 'visualConcepts',
      'conceptStatusEvents', 'styleObservations', 'preferences', 'artifactEvaluations',
      'failureModes', 'providerEvidence', 'workflowExperiences', 'semanticRelations',
      'featureObservations',
    ];
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
        || Object.keys(bundle).some(key => !fields.includes(key))
        || Object.values(bundle).some(value => !Array.isArray(value))) {
      throw new TypeError('visual_knowledge_bundle_invalid');
    }
    const actions = [
      ['sourceIdentities', value => this.registerSourceIdentity(value)],
      ['referenceAssets', value => this.registerReferenceAsset(value)],
      ['referenceRoles', value => this.registerReferenceRole(value)],
      ['visualConcepts', value => this.registerVisualConcept(value)],
      ['conceptStatusEvents', value => this.appendConceptStatusEvent(value)],
      ['styleObservations', value => this.registerStyleObservation(value)],
      ['preferences', value => this.registerPreference(value)],
      ['artifactEvaluations', value => this.registerArtifactEvaluation(value)],
      ['failureModes', value => this.registerFailureMode(value)],
      ['providerEvidence', value => this.registerProviderEvidence(value)],
      ['workflowExperiences', value => this.registerWorkflowExperience(value)],
      ['semanticRelations', value => this.registerSemanticRelation(value)],
      ['featureObservations', value => this.registerFeatureObservation(value)],
    ];
    return this.#transaction(() => Object.fromEntries(actions.map(([key, action]) => [
      key,
      (bundle[key] ?? []).map(action),
    ])));
  }

  listLedger(projectId) {
    this.verifyProjectLedger(projectId);
    return this.#rawLedger(projectId).map(row => ({
      sequence: Number(row.event_sequence),
      event: JSON.parse(row.record_json),
    }));
  }

  #rawLedger(projectId) {
    return this.#database.prepare(`
      SELECT event_sequence, record_json FROM vk_ledger
      WHERE project_id = ? ORDER BY event_sequence
    `).all(projectId);
  }

  verifyProjectLedger(projectId) {
    const expected = new Map();
    const conceptStates = new Map();
    for (const kind of Object.keys(metadata)) {
      for (const record of this.listRecords(kind, projectId)) {
        const meta = metadata[kind];
        const validation = meta.validator(record);
        if (!validation.ok) throw new Error(`visual_knowledge_retained_record_invalid:${kind}`);
        expected.set(`${kind}:${record[meta.idProp]}`, {
          kind,
          id: record[meta.idProp],
          record,
          affectsRevision: true,
        });
        if (kind === 'VISUAL_CONCEPT') {
          conceptStates.set(record.conceptId, { status: record.initialStatus, at: record.createdAt });
        }
      }
    }
    for (const record of this.listConceptStatusEvents(projectId)) {
      const validation = validateConceptStatusEvent(record);
      if (!validation.ok) throw new Error('visual_knowledge_retained_concept_status_invalid');
      const state = conceptStates.get(record.conceptId);
      if (!state
          || state.status !== record.fromStatus
          || Date.parse(record.occurredAt) <= Date.parse(state.at)) {
        throw new Error('visual_knowledge_concept_status_replay_invalid');
      }
      conceptStates.set(record.conceptId, { status: record.toStatus, at: record.occurredAt });
      expected.set(`CONCEPT_STATUS_EVENT:${record.statusEventId}`, {
        kind: 'CONCEPT_STATUS_EVENT',
        id: record.statusEventId,
        record,
        affectsRevision: true,
      });
    }
    for (const [table, idColumn, kind] of [
      ['vk_atlas_snapshots', 'atlas_snapshot_id', 'ATLAS_SNAPSHOT'],
      ['vk_retrieval_contexts', 'retrieval_context_id', 'RETRIEVAL_CONTEXT'],
    ]) {
      const rows = this.#database.prepare(`
        SELECT ${idColumn} AS id, record_json FROM ${table}
        WHERE project_id = ? ORDER BY rowid
      `).all(projectId);
      for (const row of rows) {
        const record = JSON.parse(row.record_json);
        const validation = kind === 'ATLAS_SNAPSHOT'
          ? validateAtlasSnapshot(record)
          : validateRetrievalContext(record);
        if (!validation.ok) throw new Error(`visual_knowledge_retained_derived_invalid:${kind}`);
        expected.set(`${kind}:${row.id}`, {
          kind, id: row.id, record, affectsRevision: false,
        });
      }
    }
    const rows = this.#database.prepare(`
      SELECT event_sequence, ledger_event_id, project_id, record_kind, record_id,
             record_digest, affects_revision, record_json
      FROM vk_ledger WHERE project_id = ? ORDER BY event_sequence
    `).all(projectId);
    if (rows.length !== expected.size) throw new Error('visual_knowledge_ledger_count_mismatch');
    let previousSequence = 0;
    let revision = 0;
    for (const row of rows) {
      const key = `${row.record_kind}:${row.record_id}`;
      const source = expected.get(key);
      const event = JSON.parse(row.record_json);
      const sequence = Number(row.event_sequence);
      if (!source
          || sequence <= previousSequence
          || row.ledger_event_id !== `knowledge-ledger:${source.kind}:${source.id}`
          || row.project_id !== projectId
          || row.record_digest !== digest(source.record)
          || Boolean(row.affects_revision) !== source.affectsRevision
          || event.schema !== 'eve-atelier-visual-knowledge-ledger-event/v1'
          || event.ledgerEventId !== row.ledger_event_id
          || event.projectId !== projectId
          || event.recordKind !== source.kind
          || event.recordId !== source.id
          || event.recordDigest !== row.record_digest
          || event.affectsRevision !== source.affectsRevision) {
        throw new Error('visual_knowledge_ledger_binding_invalid');
      }
      previousSequence = sequence;
      if (source.affectsRevision) revision = sequence;
      expected.delete(key);
    }
    if (expected.size !== 0) throw new Error('visual_knowledge_ledger_orphan_record');
    return { projectId, revision, recordCount: rows.length, lastSequence: previousSequence };
  }

  close() {
    this.#database.close();
  }
}
