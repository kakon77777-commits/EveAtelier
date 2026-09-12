import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../operator-runtime/canonical.js';
import { isCanonicalInstant } from '../operator-runtime/time.js';
import {
  cloneVisualValue,
  createDigest,
  normalizeVisualValue,
  validateAadsSession,
  validateConstraintPacket,
  validateContextSnapshot,
  validateOperatorPlan,
  validateRabclWorkflow,
  validateSessionEvent,
  validateVisualIntent,
  validateWorkerContextProjection,
  validateWorkerProfile,
} from './contracts.js';
import { buildWorkerContextProjection } from './context-home.js';

const zeroUsage = Object.freeze({
  iterations: 0,
  providerCalls: 0,
  candidates: 0,
  repairLoops: 0,
  costUnits: 0,
  latencyMs: 0,
});

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

function requiredStore(value, methods, reason) {
  if (!value || methods.some(method => typeof value[method] !== 'function')) {
    throw new TypeError(reason);
  }
  return value;
}

function actionForNode(node) {
  if (node.kind === 'OPERATOR') return 'EXECUTE';
  if (node.kind === 'EVALUATE') return 'EVALUATE';
  if (node.kind === 'HUMAN_GATE') return 'REQUEST_HUMAN';
  if (node.kind === 'PROMOTE') return 'PROMOTE';
  return 'STOP';
}

function projectedBudgetExceeded(session, snapshot, node) {
  const budget = session.budget;
  const current = snapshot.usage;
  return current.iterations + 1 > budget.maxIterations
    || current.providerCalls + (node.kind === 'OPERATOR' ? 1 : 0) > budget.maxProviderCalls
    || current.candidates + (node.kind === 'OPERATOR'
      && node.commit.kind === 'CANDIDATE_VERSION' ? 1 : 0) > budget.maxCandidates
    || current.repairLoops > budget.maxRepairLoops
    || current.costUnits > budget.maxCostUnits
    || current.latencyMs > budget.maxLatencyMs;
}

function assertUsageSemantics(request, node) {
  const delta = request.usageDelta;
  if (request.type === 'NODE_STARTED') {
    if (delta.iterations !== 1
        || Object.entries(delta).some(([key, value]) => key !== 'iterations' && value !== 0)) {
      throw new Error('aads_node_start_usage_invalid');
    }
    return;
  }
  if (['NODE_SUCCEEDED', 'NODE_FAILED'].includes(request.type) && node.kind === 'OPERATOR') {
    const expectedCandidates = request.type === 'NODE_SUCCEEDED'
      && node.commit.kind === 'CANDIDATE_VERSION' ? 1 : 0;
    if (delta.iterations !== 0
        || delta.providerCalls !== 1
        || delta.candidates !== expectedCandidates) {
      throw new Error('aads_operator_usage_invalid');
    }
    return;
  }
  if (!['SESSION_STOPPED', 'SESSION_FAILED'].includes(request.type)
      && (delta.iterations !== 0 || delta.providerCalls !== 0 || delta.candidates !== 0)) {
    throw new Error('aads_non_operator_usage_invalid');
  }
}

function assertTransition({ request, node, snapshot, current }) {
  const next = request.output.nextNodeId;
  if (request.type === 'SESSION_STARTED') {
    if (current !== null
        || request.nodeId !== null
        || request.decision !== null
        || typeof next !== 'string') throw new Error('aads_session_started_transition_invalid');
    return;
  }
  if (request.type === 'NODE_STARTED') {
    if (snapshot?.status !== 'ACTIVE'
        || snapshot.inFlightNodeId !== null
        || snapshot.currentNodeId !== node.nodeId
        || request.decision !== null
        || next !== node.nodeId) throw new Error('rabcl_node_start_transition_invalid');
    return;
  }
  if (request.type === 'NODE_SUCCEEDED') {
    if (snapshot?.inFlightNodeId !== node.nodeId) {
      throw new Error('rabcl_node_terminal_without_start');
    }
    if (node.kind === 'OPERATOR'
        && (request.decision !== null || next !== node.onSuccess)) {
      throw new Error('rabcl_operator_success_transition_invalid');
    }
    if (node.kind === 'EVALUATE') {
      const expected = request.decision === 'ACCEPT'
        ? node.onAccept
        : request.decision === 'REPAIR'
          ? node.onRepair
          : request.decision === 'STOP'
            ? node.onReject
            : null;
      if (expected === null || next !== expected) {
        throw new Error('rabcl_evaluation_transition_invalid');
      }
    }
    if (node.kind === 'PROMOTE'
        && (request.decision !== 'ACCEPT' || next !== node.onSuccess)) {
      throw new Error('rabcl_promotion_success_transition_invalid');
    }
    if (!['OPERATOR', 'EVALUATE', 'PROMOTE'].includes(node.kind)) {
      throw new Error('rabcl_node_success_kind_invalid');
    }
    return;
  }
  if (request.type === 'NODE_FAILED') {
    if (snapshot?.inFlightNodeId !== node.nodeId) {
      throw new Error('rabcl_node_terminal_without_start');
    }
    if (node.kind === 'OPERATOR') {
      if (request.decision === 'STOP') {
        if (next !== node.onFailure) throw new Error('rabcl_operator_failure_transition_invalid');
      } else {
        const fallback = node.fallback.find(item => item.decision === request.decision);
        if (!fallback
            || next !== fallback.nodeId
            || request.output.retryAuthorized !== true) {
          throw new Error('rabcl_operator_fallback_transition_invalid');
        }
      }
    } else if (node.kind === 'EVALUATE') {
      if (request.decision !== 'STOP' || next !== node.onReject) {
        throw new Error('rabcl_evaluation_failure_transition_invalid');
      }
    } else if (node.kind === 'PROMOTE') {
      if (request.decision !== 'STOP' || next !== node.onFailure) {
        throw new Error('rabcl_promotion_failure_transition_invalid');
      }
    } else {
      throw new Error('rabcl_node_failure_kind_invalid');
    }
    return;
  }
  if (request.type === 'HUMAN_GATE_WAITING') {
    if (node.kind !== 'HUMAN_GATE'
        || snapshot?.inFlightNodeId !== node.nodeId
        || request.decision !== 'ASK_HUMAN'
        || next !== node.nodeId) throw new Error('rabcl_human_wait_transition_invalid');
    return;
  }
  if (request.type === 'HUMAN_DECISION') {
    const expected = request.decision === 'ACCEPT'
      ? node.onApprove
      : request.decision === 'STOP'
        ? node.onReject
        : null;
    if (node.kind !== 'HUMAN_GATE'
        || snapshot?.status !== 'WAITING_HUMAN'
        || snapshot.currentNodeId !== node.nodeId
        || expected === null
        || next !== expected) throw new Error('rabcl_human_decision_transition_invalid');
    return;
  }
  if (['SESSION_COMPLETED', 'SESSION_STOPPED', 'SESSION_FAILED'].includes(request.type)) {
    const terminalOutcomes = [
      'ACCEPTED', 'REJECTED', 'NEEDS_HUMAN', 'BUDGET_EXHAUSTED', 'FAILED',
    ];
    if (request.actor.kind !== 'SYSTEM'
        || request.decision !== (request.type === 'SESSION_COMPLETED' ? 'ACCEPT' : 'STOP')
        || next !== null
        || !terminalOutcomes.includes(request.output.outcome)
        || (request.type === 'SESSION_STOPPED' && request.output.outcome === 'ACCEPTED')
        || (request.type === 'SESSION_FAILED' && request.output.outcome !== 'FAILED')) {
      throw new Error('aads_session_terminal_transition_invalid');
    }
    if (request.type === 'SESSION_COMPLETED'
        && (node?.kind !== 'STOP' || node.outcome !== 'ACCEPTED'
          || request.output.outcome !== 'ACCEPTED')) {
      throw new Error('aads_session_completion_transition_invalid');
    }
    return;
  }
  throw new Error('aads_session_event_transition_unsupported');
}

export class VisualIntelligenceStore {
  #database;
  #artDocumentStore;
  #operatorStore;
  #assetStore;
  #visualKnowledgeStore;

  constructor({
    path = ':memory:',
    artDocumentStore,
    operatorStore,
    assetStore,
    visualKnowledgeStore = null,
  }) {
    this.#artDocumentStore = requiredStore(
      artDocumentStore,
      ['getDocumentSnapshot', 'getVersionGraphSeal'],
      'aads_art_document_store_required',
    );
    this.#operatorStore = requiredStore(
      operatorStore,
      ['getPack', 'getStatus'],
      'aads_operator_store_required',
    );
    this.#assetStore = requiredStore(
      assetStore,
      ['verifyAsset'],
      'aads_asset_store_required',
    );
    this.#visualKnowledgeStore = visualKnowledgeStore === null
      ? null
      : requiredStore(
          visualKnowledgeStore,
          ['getRetrievalContext'],
          'aads_visual_knowledge_store_invalid',
        );
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS vi_intents (
        intent_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vi_constraint_packets (
        packet_id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (intent_id) REFERENCES vi_intents(intent_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vi_operator_plans (
        plan_id TEXT PRIMARY KEY,
        packet_id TEXT NOT NULL UNIQUE,
        pack_id TEXT NOT NULL,
        pack_version TEXT NOT NULL,
        pack_digest TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (packet_id) REFERENCES vi_constraint_packets(packet_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vi_workflows (
        workflow_id TEXT PRIMARY KEY,
        workflow_version TEXT NOT NULL,
        plan_id TEXT NOT NULL UNIQUE,
        packet_id TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES vi_operator_plans(plan_id),
        FOREIGN KEY (packet_id) REFERENCES vi_constraint_packets(packet_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vi_context_snapshots (
        context_snapshot_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        context_version INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(project_id, context_version)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vi_worker_profiles (
        profile_id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vi_worker_projections (
        projection_id TEXT PRIMARY KEY,
        context_snapshot_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        context_digest TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (context_snapshot_id) REFERENCES vi_context_snapshots(context_snapshot_id),
        FOREIGN KEY (profile_id) REFERENCES vi_worker_profiles(profile_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vi_sessions (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        intent_id TEXT NOT NULL,
        packet_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        context_snapshot_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (intent_id) REFERENCES vi_intents(intent_id),
        FOREIGN KEY (packet_id) REFERENCES vi_constraint_packets(packet_id),
        FOREIGN KEY (plan_id) REFERENCES vi_operator_plans(plan_id),
        FOREIGN KEY (workflow_id) REFERENCES vi_workflows(workflow_id),
        FOREIGN KEY (context_snapshot_id) REFERENCES vi_context_snapshots(context_snapshot_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS vi_events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        session_sequence INTEGER NOT NULL,
        event_digest TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        node_id TEXT,
        record_json TEXT NOT NULL,
        UNIQUE(session_id, session_sequence),
        FOREIGN KEY (session_id) REFERENCES vi_sessions(session_id)
      ) STRICT;

      ${immutableTriggers('vi_intents', 'intent_id = NEW.intent_id')}
      ${immutableTriggers('vi_constraint_packets', 'packet_id = NEW.packet_id OR intent_id = NEW.intent_id')}
      ${immutableTriggers('vi_operator_plans', 'plan_id = NEW.plan_id OR packet_id = NEW.packet_id')}
      ${immutableTriggers('vi_workflows', 'workflow_id = NEW.workflow_id OR plan_id = NEW.plan_id OR packet_id = NEW.packet_id')}
      ${immutableTriggers('vi_context_snapshots', 'context_snapshot_id = NEW.context_snapshot_id OR (project_id = NEW.project_id AND context_version = NEW.context_version)')}
      ${immutableTriggers('vi_worker_profiles', 'profile_id = NEW.profile_id')}
      ${immutableTriggers('vi_worker_projections', 'projection_id = NEW.projection_id')}
      ${immutableTriggers('vi_sessions', 'session_id = NEW.session_id')}
      ${immutableTriggers('vi_events', 'event_id = NEW.event_id OR event_digest = NEW.event_digest OR (session_id = NEW.session_id AND session_sequence = NEW.session_sequence) OR event_sequence = NEW.event_sequence')}
    `);
  }

  bindVisualKnowledgeStore(store) {
    const resolved = requiredStore(
      store,
      ['getRetrievalContext'],
      'aads_visual_knowledge_store_invalid',
    );
    if (this.#visualKnowledgeStore !== null && this.#visualKnowledgeStore !== resolved) {
      throw new Error('aads_visual_knowledge_store_already_bound');
    }
    this.#visualKnowledgeStore = resolved;
    return true;
  }

  #transaction(action) {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #append({ table, idColumn, id, record, columns, values, conflict }) {
    const existing = this.#database.prepare(`
      SELECT record_json FROM ${table} WHERE ${idColumn} = ?
    `).get(id);
    if (existing) {
      const retained = JSON.parse(existing.record_json);
      if (canonicalJson(retained) !== canonicalJson(record)) throw new Error(conflict);
      return retained;
    }
    this.#database.prepare(`
      INSERT INTO ${table} (${columns.join(', ')}, record_json)
      VALUES (${columns.map(() => '?').join(', ')}, ?)
    `).run(...values, canonicalJson(record));
    return cloneVisualValue(record);
  }

  #get(table, idColumn, id, missing) {
    const row = this.#database.prepare(`
      SELECT record_json FROM ${table} WHERE ${idColumn} = ?
    `).get(id);
    if (!row) throw new Error(missing);
    return JSON.parse(row.record_json);
  }

  registerIntent(raw) {
    const value = normalizeVisualValue(raw, 'aads_visual_intent_json_value_invalid');
    const validation = validateVisualIntent(value);
    if (!validation.ok) throw new Error(validation.reason);
    const art = this.#artDocumentStore.getDocumentSnapshot(value.documentId);
    if (art.document.projectId !== value.projectId) throw new Error('aads_intent_project_mismatch');
    for (const reference of value.references) this.#assetStore.verifyAsset(reference.assetRef);
    return this.#append({
      table: 'vi_intents', idColumn: 'intent_id', id: value.intentId, record: value,
      columns: ['intent_id', 'project_id', 'document_id'],
      values: [value.intentId, value.projectId, value.documentId],
      conflict: 'aads_intent_id_conflict',
    });
  }

  getIntent(id) {
    return this.#get('vi_intents', 'intent_id', id, 'aads_intent_not_found');
  }

  registerConstraintPacket(raw) {
    const value = normalizeVisualValue(raw, 'aads_constraint_packet_json_value_invalid');
    const validation = validateConstraintPacket(value);
    if (!validation.ok) throw new Error(validation.reason);
    const intent = this.getIntent(value.intentId);
    if (intent.projectId !== value.projectId || intent.documentId !== value.documentId) {
      throw new Error('aads_constraint_packet_intent_scope_mismatch');
    }
    if (Date.parse(value.compiledAt) < Date.parse(intent.submittedAt)) {
      throw new Error('aads_constraint_compiled_before_intent');
    }
    for (const direction of value.referenceDirections) this.#assetStore.verifyAsset(direction.assetRef);
    const intendedDirections = intent.references.map(reference => canonicalJson({
      assetRef: reference.assetRef,
      role: reference.role,
      appliesTo: reference.appliesTo,
    })).sort();
    const compiledDirections = value.referenceDirections.map(direction => canonicalJson({
      assetRef: direction.assetRef,
      role: direction.role,
      appliesTo: direction.appliesTo,
    })).sort();
    if (canonicalJson(intendedDirections) !== canonicalJson(compiledDirections)) {
      throw new Error('aads_constraint_reference_direction_mismatch');
    }
    const localOnlyReference = intent.hardConstraints.some(item => (
      item.dimension === 'PRIVACY' && item.requirement.startsWith('LOCAL_ONLY_REFERENCE:')
    ));
    if (localOnlyReference
        && (value.providerPolicy.allowedPrivacy.length !== 1
          || value.providerPolicy.allowedPrivacy[0] !== 'LOCAL')) {
      throw new Error('aads_private_reference_requires_local_provider');
    }
    if (value.schema === 'eve-atelier-constraint-packet/v2') {
      const retrievals = this.#assertRetrievalContexts(value.retrievalContextRefs, value.projectId);
      for (const retrieval of retrievals) {
        if (retrieval.query.allowedRightsClasses.includes('UNKNOWN')
            && (value.providerPolicy.allowedPrivacy.length !== 1
              || value.providerPolicy.allowedPrivacy[0] !== 'LOCAL')) {
          throw new Error('aads_unknown_rights_requires_local_provider');
        }
        if (retrieval.query.allowedRightsClasses.includes('PRIVATE_RESEARCH')
            && value.providerPolicy.allowedPrivacy.includes('REMOTE_PUBLIC')) {
          throw new Error('aads_private_retrieval_remote_public_forbidden');
        }
      }
    }
    return this.#append({
      table: 'vi_constraint_packets', idColumn: 'packet_id', id: value.packetId,
      record: value,
      columns: ['packet_id', 'intent_id', 'project_id', 'document_id'],
      values: [value.packetId, value.intentId, value.projectId, value.documentId],
      conflict: 'aads_constraint_packet_id_conflict',
    });
  }

  getConstraintPacket(id) {
    return this.#get(
      'vi_constraint_packets', 'packet_id', id, 'aads_constraint_packet_not_found',
    );
  }

  registerOperatorPlan(raw) {
    const value = normalizeVisualValue(raw, 'aads_operator_plan_json_value_invalid');
    const validation = validateOperatorPlan(value);
    if (!validation.ok) throw new Error(validation.reason);
    const packet = this.getConstraintPacket(value.packetId);
    if (packet.taskType !== value.taskType) throw new Error('aads_operator_plan_task_mismatch');
    if (Date.parse(value.createdAt) < Date.parse(packet.compiledAt)) {
      throw new Error('aads_operator_plan_before_constraint_packet');
    }
    const pack = this.#operatorStore.getPack(value.packRef);
    if (this.#operatorStore.getStatus(value.packRef) !== 'ACTIVE') {
      throw new Error('aads_operator_plan_pack_not_active');
    }
    const available = new Set(pack.families.flatMap(family => family.variants)
      .map(operator => `${operator.operatorId}@${operator.version}`));
    for (const step of value.steps) {
      if (!available.has(`${step.operatorRef.operatorId}@${step.operatorRef.version}`)) {
        throw new Error(`aads_operator_plan_operator_missing:${step.operatorRef.operatorId}`);
      }
    }
    return this.#append({
      table: 'vi_operator_plans', idColumn: 'plan_id', id: value.planId, record: value,
      columns: ['plan_id', 'packet_id', 'pack_id', 'pack_version', 'pack_digest'],
      values: [
        value.planId, value.packetId, value.packRef.packId,
        value.packRef.version, value.packRef.digest,
      ],
      conflict: 'aads_operator_plan_id_conflict',
    });
  }

  getOperatorPlan(id) {
    return this.#get('vi_operator_plans', 'plan_id', id, 'aads_operator_plan_not_found');
  }

  registerWorkflow(raw) {
    const value = normalizeVisualValue(raw, 'rabcl_workflow_json_value_invalid');
    const validation = validateRabclWorkflow(value);
    if (!validation.ok) throw new Error(validation.reason);
    const plan = this.getOperatorPlan(value.planId);
    if (plan.packetId !== value.packetId) throw new Error('rabcl_workflow_plan_scope_mismatch');
    const packet = this.getConstraintPacket(value.packetId);
    if (Date.parse(value.createdAt) < Date.parse(plan.createdAt)
        || Date.parse(value.createdAt) < Date.parse(packet.compiledAt)) {
      throw new Error('rabcl_workflow_before_plan');
    }
    const planOperators = new Set(plan.steps.map(step => (
      `${step.operatorRef.operatorId}@${step.operatorRef.version}`
    )));
    const workflowOperators = value.nodes.filter(item => item.kind === 'OPERATOR');
    for (const step of plan.steps) {
      if (!workflowOperators.some(node => (
        node.operatorRef.operatorId === step.operatorRef.operatorId
        && node.operatorRef.version === step.operatorRef.version
      ))) throw new Error(`rabcl_workflow_planned_step_missing:${step.stepId}`);
    }
    const pack = this.#operatorStore.getPack(plan.packRef);
    for (const node of workflowOperators) {
      if (!planOperators.has(`${node.operatorRef.operatorId}@${node.operatorRef.version}`)) {
        throw new Error(`rabcl_workflow_operator_not_planned:${node.operatorRef.operatorId}`);
      }
      const operator = pack.families.flatMap(family => family.variants).find(item => (
        item.operatorId === node.operatorRef.operatorId
        && item.version === node.operatorRef.version
      ));
      const allowedFallbacks = new Set((operator.fallbackDecisions ?? [])
        .map(decision => decision === 'RECOMPILE_REQUEST' ? 'RECOMPILE' : decision));
      if (node.fallback.some(item => !allowedFallbacks.has(item.decision))) {
        throw new Error(`rabcl_workflow_operator_fallback_forbidden:${node.nodeId}`);
      }
      if (node.providerPolicy.allowedPrivacy.some(item => (
        !packet.providerPolicy.allowedPrivacy.includes(item)
      ))
          || (packet.providerPolicy.requireLocal
            && node.providerPolicy.allowedPrivacy.some(item => item !== 'LOCAL'))) {
        throw new Error(`rabcl_workflow_provider_policy_widened:${node.nodeId}`);
      }
    }
    return this.#append({
      table: 'vi_workflows', idColumn: 'workflow_id', id: value.workflowId,
      record: value,
      columns: ['workflow_id', 'workflow_version', 'plan_id', 'packet_id'],
      values: [value.workflowId, value.version, value.planId, value.packetId],
      conflict: 'rabcl_workflow_id_conflict',
    });
  }

  getWorkflow(id) {
    return this.#get('vi_workflows', 'workflow_id', id, 'rabcl_workflow_not_found');
  }

  registerContextSnapshot(raw) {
    const value = normalizeVisualValue(raw, 'aads_context_snapshot_json_value_invalid');
    const validation = validateContextSnapshot(value);
    if (!validation.ok) throw new Error(validation.reason);
    const existing = this.#database.prepare(`
      SELECT record_json FROM vi_context_snapshots WHERE context_snapshot_id = ?
    `).get(value.contextSnapshotId);
    if (existing) {
      const retained = JSON.parse(existing.record_json);
      if (canonicalJson(retained) !== canonicalJson(value)) {
        throw new Error('aads_context_snapshot_id_conflict');
      }
      return retained;
    }
    const latest = this.#database.prepare(`
      SELECT MAX(context_version) AS version FROM vi_context_snapshots WHERE project_id = ?
    `).get(value.projectId).version;
    const expectedVersion = latest === null ? 1 : Number(latest) + 1;
    if (value.contextVersion !== expectedVersion) {
      throw new Error(`aads_context_version_out_of_sequence:${expectedVersion}`);
    }
    for (const document of value.artDocuments) {
      const snapshot = this.#artDocumentStore.getDocumentSnapshot(document.documentId);
      if (snapshot.document.projectId !== value.projectId
          || snapshot.currentVersion.versionId !== document.versionId
          || snapshot.documentRevision !== document.documentRevision
          || snapshot.componentGraph.componentDigest !== document.componentGraphDigest) {
        throw new Error(`aads_context_document_stale:${document.documentId}`);
      }
    }
    for (const ref of value.operatorPackRefs) this.#operatorStore.getPack(ref);
    if (value.schema === 'eve-atelier-project-context-snapshot/v2') {
      this.#assertRetrievalContexts(value.retrievalContextRefs, value.projectId);
    }
    return this.#append({
      table: 'vi_context_snapshots', idColumn: 'context_snapshot_id',
      id: value.contextSnapshotId, record: value,
      columns: ['context_snapshot_id', 'project_id', 'context_version'],
      values: [value.contextSnapshotId, value.projectId, value.contextVersion],
      conflict: 'aads_context_snapshot_id_conflict',
    });
  }

  getContextSnapshot(id) {
    return this.#get(
      'vi_context_snapshots', 'context_snapshot_id', id, 'aads_context_snapshot_not_found',
    );
  }

  getLatestContextSnapshot(projectId) {
    const row = this.#database.prepare(`
      SELECT record_json FROM vi_context_snapshots
      WHERE project_id = ? ORDER BY context_version DESC LIMIT 1
    `).get(projectId);
    if (!row) throw new Error('aads_context_snapshot_not_found');
    return JSON.parse(row.record_json);
  }

  registerWorkerProfile(raw) {
    const value = normalizeVisualValue(raw, 'aads_worker_profile_json_value_invalid');
    const validation = validateWorkerProfile(value);
    if (!validation.ok) throw new Error(validation.reason);
    return this.#append({
      table: 'vi_worker_profiles', idColumn: 'profile_id', id: value.profileId,
      record: value, columns: ['profile_id'], values: [value.profileId],
      conflict: 'aads_worker_profile_id_conflict',
    });
  }

  getWorkerProfile(id) {
    return this.#get('vi_worker_profiles', 'profile_id', id, 'aads_worker_profile_not_found');
  }

  recordWorkerProjection(raw) {
    const value = normalizeVisualValue(raw, 'aads_worker_projection_json_value_invalid');
    const validation = validateWorkerContextProjection(value);
    if (!validation.ok) throw new Error(validation.reason);
    const context = this.getContextSnapshot(value.contextSnapshotId);
    const profile = this.getWorkerProfile(value.profileId);
    if (createDigest(context) !== value.contextDigest
        || context.projectId !== value.projectId
        || profile.purpose !== value.purpose
        || canonicalJson(profile.allowedSections) !== canonicalJson(value.limits.allowedSections)
        || profile.maxEntriesPerSection !== value.limits.maxEntriesPerSection) {
      throw new Error('aads_worker_projection_source_mismatch');
    }
    const expected = buildWorkerContextProjection({
      contextSnapshot: context,
      profile,
      projectionId: value.projectionId,
      createdAt: value.createdAt,
    });
    if (canonicalJson(expected) !== canonicalJson(value)) {
      throw new Error('aads_worker_projection_content_mismatch');
    }
    return this.#append({
      table: 'vi_worker_projections', idColumn: 'projection_id', id: value.projectionId,
      record: value,
      columns: ['projection_id', 'context_snapshot_id', 'profile_id', 'context_digest'],
      values: [
        value.projectionId, value.contextSnapshotId, value.profileId, value.contextDigest,
      ],
      conflict: 'aads_worker_projection_id_conflict',
    });
  }

  getWorkerProjection(id) {
    return this.#get(
      'vi_worker_projections', 'projection_id', id, 'aads_worker_projection_not_found',
    );
  }

  listWorkerProjections({ contextSnapshotId = null, profileId = null } = {}) {
    const clauses = [];
    const values = [];
    if (contextSnapshotId !== null) {
      clauses.push('context_snapshot_id = ?');
      values.push(contextSnapshotId);
    }
    if (profileId !== null) {
      clauses.push('profile_id = ?');
      values.push(profileId);
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    return this.#database.prepare(`
      SELECT record_json FROM vi_worker_projections ${where} ORDER BY rowid
    `).all(...values).map(row => JSON.parse(row.record_json));
  }

  createSession(raw) {
    const value = normalizeVisualValue(raw, 'aads_session_json_value_invalid');
    const validation = validateAadsSession(value);
    if (!validation.ok) throw new Error(validation.reason);
    return this.#transaction(() => this.#createSession(value));
  }

  #createSession(value) {
      const intent = this.getIntent(value.intentId);
      const packet = this.getConstraintPacket(value.packetId);
      const plan = this.getOperatorPlan(value.planId);
      const workflow = this.getWorkflow(value.workflowId);
      const context = this.getContextSnapshot(value.contextSnapshotId);
      if (intent.projectId !== value.projectId
          || intent.documentId !== value.documentId
          || packet.intentId !== value.intentId
          || plan.packetId !== value.packetId
          || workflow.planId !== value.planId
          || context.projectId !== value.projectId
          || !context.activeSessionRefs.includes(value.sessionId)
          || packet.taskType !== value.taskType) {
        throw new Error('aads_session_reference_mismatch');
      }
      const packetRetrieval = packet.retrievalContextRefs ?? [];
      const contextRetrieval = context.retrievalContextRefs ?? [];
      if (canonicalJson(packetRetrieval) !== canonicalJson(contextRetrieval)) {
        throw new Error('aads_session_retrieval_context_mismatch');
      }
      const art = this.#artDocumentStore.getDocumentSnapshot(value.documentId);
      const initial = value.initialArtState;
      if (art.document.projectId !== value.projectId
          || art.currentVersion.versionId !== initial.currentVersionId
          || initial.versionId !== initial.currentVersionId
          || art.documentRevision !== initial.documentRevision
          || art.componentGraph.componentDigest !== initial.componentGraphDigest) {
        throw new Error('aads_session_initial_art_state_stale');
      }
      if (!value.authority.allowedActions.includes('PLAN')) {
        throw new Error('aads_session_plan_authority_required');
      }
      if (!value.authority.allowedActions.includes('STOP')
          || !value.authority.allowedDecisionKinds.includes('STOP')) {
        throw new Error('aads_session_stop_authority_required');
      }
      if (value.budget.maxCostUnits > packet.providerPolicy.maxCostUnits
          || value.budget.maxLatencyMs > packet.providerPolicy.maxLatencyMs) {
        throw new Error('aads_session_budget_exceeds_constraint_packet');
      }
      const workflowDecisions = new Set(['STOP']);
      for (const node of workflow.nodes) {
        if (node.kind === 'EVALUATE') {
          workflowDecisions.add('ACCEPT');
          workflowDecisions.add('REPAIR');
        }
        if (node.kind === 'HUMAN_GATE') {
          workflowDecisions.add('ASK_HUMAN');
          workflowDecisions.add('ACCEPT');
        }
        if (node.kind === 'PROMOTE' || (node.kind === 'STOP' && node.outcome === 'ACCEPTED')) {
          workflowDecisions.add('ACCEPT');
        }
        for (const fallback of node.fallback ?? []) workflowDecisions.add(fallback.decision);
      }
      if ([...workflowDecisions].some(decision => (
        !value.authority.allowedDecisionKinds.includes(decision)
      ))) throw new Error('aads_session_workflow_decision_authority_missing');
      const createdAt = Date.parse(value.createdAt);
      if ([
        intent.submittedAt,
        packet.compiledAt,
        plan.createdAt,
        workflow.createdAt,
        context.createdAt,
      ].some(item => createdAt < Date.parse(item))) {
        throw new Error('aads_session_created_before_dependencies');
      }
      const retained = this.#append({
        table: 'vi_sessions', idColumn: 'session_id', id: value.sessionId, record: value,
        columns: [
          'session_id', 'project_id', 'document_id', 'intent_id', 'packet_id',
          'plan_id', 'workflow_id', 'context_snapshot_id',
        ],
        values: [
          value.sessionId, value.projectId, value.documentId, value.intentId,
          value.packetId, value.planId, value.workflowId, value.contextSnapshotId,
        ],
        conflict: 'aads_session_id_conflict',
      });
      this.appendEvent({
        eventId: `aads-event:${value.sessionId}:started`,
        sessionId: value.sessionId,
        expectedSequence: 0,
        type: 'SESSION_STARTED',
        nodeId: null,
        decision: null,
        output: { nextNodeId: workflow.entryNodeId },
        usageDelta: zeroUsage,
        evidenceRefs: [value.authority.grantRef],
        actor: value.createdBy,
        occurredAt: value.createdAt,
      });
      return retained;
  }

  registerSessionBundle({ intent, packet, plan, workflow, context, session } = {}) {
    return this.#transaction(() => {
      const retainedIntent = this.registerIntent(intent);
      const retainedPacket = this.registerConstraintPacket(packet);
      const retainedPlan = this.registerOperatorPlan(plan);
      const retainedWorkflow = this.registerWorkflow(workflow);
      const retainedContext = this.registerContextSnapshot(context);
      const normalizedSession = normalizeVisualValue(
        session,
        'aads_session_json_value_invalid',
      );
      const validation = validateAadsSession(normalizedSession);
      if (!validation.ok) throw new Error(validation.reason);
      const retainedSession = this.#createSession(normalizedSession);
      return {
        intent: retainedIntent,
        packet: retainedPacket,
        plan: retainedPlan,
        workflow: retainedWorkflow,
        context: retainedContext,
        session: retainedSession,
      };
    });
  }

  getSession(id) {
    return this.#get('vi_sessions', 'session_id', id, 'aads_session_not_found');
  }

  appendEvent(raw) {
    const request = normalizeVisualValue(raw, 'aads_session_event_request_json_value_invalid');
    const fields = [
      'eventId', 'sessionId', 'expectedSequence', 'type', 'nodeId', 'decision',
      'output', 'usageDelta', 'evidenceRefs', 'actor', 'occurredAt',
    ];
    if (!request
        || typeof request !== 'object'
        || Array.isArray(request)
        || Object.keys(request).length !== fields.length
        || Object.keys(request).some(key => !fields.includes(key))
        || !Number.isSafeInteger(request.expectedSequence)
        || request.expectedSequence < 0
        || !isCanonicalInstant(request.occurredAt)) {
      throw new Error('aads_session_event_request_invalid');
    }
    const session = this.getSession(request.sessionId);
    const workflow = this.getWorkflow(session.workflowId);
    const current = this.#latestEvent(request.sessionId, { allowMissing: true });
    const currentSequence = current?.sequence ?? 0;
    if (request.expectedSequence !== currentSequence) {
      throw new Error(`aads_session_event_stale:${currentSequence}`);
    }
    const snapshot = current === null ? null : this.getSessionSnapshot(request.sessionId);
    if (snapshot && ['COMPLETED', 'STOPPED', 'FAILED'].includes(snapshot.status)) {
      throw new Error('aads_session_terminal');
    }
    if (snapshot?.status === 'WAITING_HUMAN' && request.type !== 'HUMAN_DECISION') {
      throw new Error('aads_session_waiting_human');
    }
    if (request.type === 'SESSION_STARTED'
        && (current !== null || request.expectedSequence !== 0)) {
      throw new Error('aads_session_started_event_invalid');
    }
    if (current && Date.parse(request.occurredAt) <= Date.parse(current.event.occurredAt)) {
      throw new Error('aads_session_event_time_not_monotonic');
    }
    const node = request.nodeId === null
      ? null
      : workflow.nodes.find(item => item.nodeId === request.nodeId);
    if (request.nodeId !== null && !node) throw new Error('aads_session_event_node_missing');
    if (['NODE_STARTED', 'NODE_SUCCEEDED', 'NODE_FAILED', 'HUMAN_GATE_WAITING']
      .includes(request.type)) {
      const action = actionForNode(node);
      if (!session.authority.allowedActions.includes(action)) {
        throw new Error(`aads_session_action_forbidden:${action}`);
      }
      if (node.kind === 'PROMOTE' && session.authority.promotionMode !== 'POLICY_GATED') {
        throw new Error('aads_session_promotion_forbidden');
      }
    }
    if (request.type === 'HUMAN_DECISION') {
      if (!session.authority.allowedActions.includes('REQUEST_HUMAN')) {
        throw new Error('aads_session_action_forbidden:REQUEST_HUMAN');
      }
      if (!validateArtActorLike(request.actor, ['HUMAN'])) {
        throw new Error('aads_human_decision_actor_required');
      }
      if (snapshot?.currentNodeId !== request.nodeId) {
        throw new Error('aads_human_decision_gate_mismatch');
      }
    }
    if (['SESSION_COMPLETED', 'SESSION_STOPPED', 'SESSION_FAILED'].includes(request.type)
        && !session.authority.allowedActions.includes('STOP')) {
      throw new Error('aads_session_action_forbidden:STOP');
    }
    if (request.decision !== null
        && !session.authority.allowedDecisionKinds.includes(request.decision)) {
      throw new Error(`aads_session_decision_forbidden:${request.decision}`);
    }
    if (request.output.nextNodeId !== undefined
        && request.output.nextNodeId !== null
        && !workflow.nodes.some(item => item.nodeId === request.output.nextNodeId)) {
      throw new Error('aads_session_event_next_node_missing');
    }
    if (request.type === 'NODE_STARTED' && projectedBudgetExceeded(session, snapshot, node)) {
      throw new Error('aads_session_budget_exhausted');
    }
    assertUsageSemantics(request, node);
    assertTransition({ request, node, snapshot, current });
    const event = {
      schema: 'eve-atelier-aads-session-event/v1',
      eventId: request.eventId,
      sessionId: request.sessionId,
      sequence: currentSequence + 1,
      previousEventDigest: current?.event.eventDigest ?? null,
      eventDigest: '0'.repeat(64),
      type: request.type,
      nodeId: request.nodeId,
      decision: request.decision,
      output: cloneVisualValue(request.output),
      usageDelta: cloneVisualValue(request.usageDelta),
      evidenceRefs: [...request.evidenceRefs],
      actor: cloneVisualValue(request.actor),
      occurredAt: request.occurredAt,
    };
    event.eventDigest = createDigest(Object.fromEntries(
      Object.entries(event).filter(([key]) => key !== 'eventDigest'),
    ));
    const validation = validateSessionEvent(event);
    if (!validation.ok) throw new Error(validation.reason);
    return this.#append({
      table: 'vi_events', idColumn: 'event_id', id: event.eventId, record: event,
      columns: [
        'event_id', 'session_id', 'session_sequence', 'event_digest',
        'event_type', 'node_id',
      ],
      values: [
        event.eventId, event.sessionId, event.sequence, event.eventDigest,
        event.type, event.nodeId,
      ],
      conflict: 'aads_session_event_id_conflict',
    });
  }

  #latestEvent(sessionId, { allowMissing = false } = {}) {
    const row = this.#database.prepare(`
      SELECT session_sequence, record_json FROM vi_events
      WHERE session_id = ? ORDER BY session_sequence DESC LIMIT 1
    `).get(sessionId);
    if (!row) {
      if (allowMissing) return null;
      throw new Error('aads_session_event_not_found');
    }
    return { sequence: Number(row.session_sequence), event: JSON.parse(row.record_json) };
  }

  listEvents(sessionId) {
    this.getSession(sessionId);
    const events = this.#database.prepare(`
      SELECT record_json FROM vi_events WHERE session_id = ? ORDER BY session_sequence
    `).all(sessionId).map(row => JSON.parse(row.record_json));
    let previous = null;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const expectedDigest = createDigest(Object.fromEntries(
        Object.entries(event).filter(([key]) => key !== 'eventDigest'),
      ));
      if (event.sequence !== index + 1
          || event.previousEventDigest !== previous
          || event.eventDigest !== expectedDigest) {
        throw new Error('aads_session_event_chain_invalid');
      }
      previous = event.eventDigest;
    }
    return events;
  }

  getSessionSnapshot(sessionId) {
    const session = this.getSession(sessionId);
    const workflow = this.getWorkflow(session.workflowId);
    const events = this.listEvents(sessionId);
    const usage = { ...zeroUsage };
    const outputs = {};
    const visits = {};
    const decisions = [];
    let status = 'ACTIVE';
    let currentNodeId = workflow.entryNodeId;
    let inFlightNodeId = null;
    let terminalOutcome = null;
    for (const event of events) {
      for (const key of Object.keys(usage)) usage[key] += event.usageDelta[key];
      if (event.type === 'NODE_STARTED') {
        visits[event.nodeId] = (visits[event.nodeId] ?? 0) + 1;
        currentNodeId = event.nodeId;
        inFlightNodeId = event.nodeId;
      }
      if (['NODE_SUCCEEDED', 'NODE_FAILED', 'HUMAN_DECISION'].includes(event.type)
          && event.nodeId !== null) {
        outputs[event.nodeId] = cloneVisualValue(event.output);
        inFlightNodeId = null;
      }
      if (event.decision !== null) decisions.push({
        sequence: event.sequence,
        nodeId: event.nodeId,
        decision: event.decision,
      });
      if (event.output.nextNodeId !== undefined) currentNodeId = event.output.nextNodeId;
      if (event.type === 'HUMAN_GATE_WAITING') {
        status = 'WAITING_HUMAN';
        inFlightNodeId = null;
      }
      if (event.type === 'HUMAN_DECISION') status = 'ACTIVE';
      if (event.type === 'SESSION_COMPLETED') {
        status = 'COMPLETED';
        terminalOutcome = event.output.outcome;
        currentNodeId = null;
        inFlightNodeId = null;
      }
      if (event.type === 'SESSION_STOPPED') {
        status = 'STOPPED';
        terminalOutcome = event.output.outcome;
        currentNodeId = null;
        inFlightNodeId = null;
      }
      if (event.type === 'SESSION_FAILED') {
        status = 'FAILED';
        terminalOutcome = event.output.outcome;
        currentNodeId = null;
        inFlightNodeId = null;
      }
    }
    return {
      schema: 'eve-atelier-aads-session-snapshot/v1',
      session,
      status,
      sequence: events.length,
      lastEventDigest: events.at(-1)?.eventDigest ?? null,
      currentNodeId,
      inFlightNodeId,
      outputs,
      visits,
      usage,
      decisions,
      terminalOutcome,
    };
  }

  close() {
    this.#database.close();
  }

  #assertRetrievalContexts(ids, projectId) {
    if (this.#visualKnowledgeStore === null) {
      throw new Error('aads_visual_knowledge_store_required');
    }
    const contexts = [];
    for (const id of ids) {
      const context = this.#visualKnowledgeStore.getRetrievalContext(id);
      if (context.projectId !== projectId) {
        throw new Error('aads_retrieval_context_project_mismatch');
      }
      contexts.push(context);
    }
    return contexts;
  }
}

function validateArtActorLike(value, allowedKinds) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 2
    && typeof value.kind === 'string'
    && allowedKinds.includes(value.kind)
    && typeof value.id === 'string'
    && value.id.length > 0;
}
