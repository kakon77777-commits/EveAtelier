import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, digestDefinition } from './canonical.js';
import {
  validateExperienceEvent,
  validateOperatorPack,
  validateProviderCapabilityManifest,
} from './contracts.js';
import { valueMatchesSchema } from './semantic-values.js';

function validActor(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && ['HUMAN', 'AI', 'SYSTEM'].includes(value.kind)
    && typeof value.id === 'string'
    && value.id.trim().length > 0;
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value, fields) {
  return isObject(value) && Object.keys(value).every(key => fields.includes(key));
}

function nonEmptyUniqueStrings(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'string' && item.trim().length > 0)
    && new Set(value).size === value.length;
}

const lifecycleFields = Object.freeze([
  'schema', 'eventId', 'packRef', 'fromStatus', 'toStatus', 'evidenceRefs', 'actor', 'createdAt',
]);
const packRefFields = Object.freeze(['packId', 'version', 'digest']);
const actorFields = Object.freeze(['kind', 'id']);
const lifecycleTransitions = Object.freeze({
  DRAFT: Object.freeze(['EXPERIMENTAL_UNCALIBRATED', 'DEPRECATED']),
  EXPERIMENTAL_UNCALIBRATED: Object.freeze(['CALIBRATED', 'DEPRECATED']),
  CALIBRATED: Object.freeze(['ACTIVE', 'DEPRECATED']),
  ACTIVE: Object.freeze(['DEPRECATED']),
  DEPRECATED: Object.freeze([]),
});

export class OperatorRegistryStore {
  #database;

  constructor({ path = ':memory:' } = {}) {
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS operator_packs (
        pack_id TEXT NOT NULL,
        version TEXT NOT NULL,
        digest TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        proposer_kind TEXT NOT NULL,
        proposer_id TEXT NOT NULL,
        PRIMARY KEY (pack_id, version)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS registry_events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        pack_id TEXT NOT NULL,
        version TEXT NOT NULL,
        digest TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (pack_id, version) REFERENCES operator_packs(pack_id, version)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS experience_events (
        event_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        pack_id TEXT NOT NULL,
        version TEXT NOT NULL,
        digest TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        operator_version TEXT NOT NULL,
        provider_id TEXT,
        provider_version TEXT,
        semantic_context_json TEXT NOT NULL,
        input_hashes_json TEXT NOT NULL,
        output_hashes_json TEXT NOT NULL,
        outcome TEXT NOT NULL,
        evaluation_refs_json TEXT NOT NULL,
        human_preference_ref TEXT,
        evidence_class TEXT NOT NULL,
        provenance_kind TEXT NOT NULL,
        provenance_id TEXT NOT NULL,
        failure_class TEXT,
        occurred_at TEXT NOT NULL,
        FOREIGN KEY (pack_id, version) REFERENCES operator_packs(pack_id, version)
      ) STRICT;

      CREATE TRIGGER IF NOT EXISTS operator_packs_no_update
      BEFORE UPDATE ON operator_packs
      BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS operator_packs_no_delete
      BEFORE DELETE ON operator_packs
      BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS registry_events_no_update
      BEFORE UPDATE ON registry_events
      BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS registry_events_no_delete
      BEFORE DELETE ON registry_events
      BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS experience_events_no_update
      BEFORE UPDATE ON experience_events
      BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS experience_events_no_delete
      BEFORE DELETE ON experience_events
      BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;

      CREATE TRIGGER IF NOT EXISTS operator_packs_no_replace
      BEFORE INSERT ON operator_packs
      WHEN EXISTS (
        SELECT 1 FROM operator_packs
        WHERE pack_id = NEW.pack_id AND version = NEW.version
      )
      BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS registry_events_no_replace
      BEFORE INSERT ON registry_events
      WHEN EXISTS (
        SELECT 1 FROM registry_events
        WHERE event_id = NEW.event_id
           OR (NEW.event_sequence > 0 AND event_sequence = NEW.event_sequence)
      )
      BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS experience_events_no_replace
      BEFORE INSERT ON experience_events
      WHEN EXISTS (
        SELECT 1 FROM experience_events WHERE event_id = NEW.event_id
      )
      BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
    `);
  }

  registerPack({ pack, proposer, registeredAt } = {}) {
    const validation = validateOperatorPack(pack);
    if (!validation.ok) throw new Error(validation.reason);
    if (!validActor(proposer)) throw new Error('operator_pack_proposer_invalid');
    if (!validDate(registeredAt)) throw new Error('operator_pack_registered_at_invalid');

    const digest = digestDefinition(pack);
    const existing = this.#database.prepare(`
      SELECT digest FROM operator_packs WHERE pack_id = ? AND version = ?
    `).get(pack.packId, pack.version);
    if (existing) {
      if (existing.digest !== digest) throw new Error('operator_pack_version_conflict');
      const ref = { packId: pack.packId, version: pack.version, digest };
      return { ...ref, status: this.getStatus(ref) };
    }
    this.#database.prepare(`
      INSERT INTO operator_packs (
        pack_id, version, digest, definition_json, registered_at, proposer_kind, proposer_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pack.packId,
      pack.version,
      digest,
      canonicalJson(pack),
      registeredAt,
      proposer.kind,
      proposer.id,
    );
    return { packId: pack.packId, version: pack.version, digest, status: 'DRAFT' };
  }

  getPack({ packId, version, digest } = {}) {
    const row = this.#database.prepare(`
      SELECT digest, definition_json FROM operator_packs WHERE pack_id = ? AND version = ?
    `).get(packId, version);
    if (!row) throw new Error('operator_pack_not_found');
    if (digest !== undefined && row.digest !== digest) throw new Error('operator_pack_digest_mismatch');
    return JSON.parse(row.definition_json);
  }

  getStatus({ packId, version, digest } = {}) {
    this.getPack({ packId, version, digest });
    const row = this.#database.prepare(`
      SELECT to_status FROM registry_events
      WHERE pack_id = ? AND version = ? AND digest = ?
      ORDER BY event_sequence DESC LIMIT 1
    `).get(packId, version, digest);
    return row?.to_status ?? 'DRAFT';
  }

  appendLifecycleEvent(event) {
    if (!exactFields(event, lifecycleFields)) throw new Error('lifecycle_event_invalid');
    if (event.schema !== 'eve-atelier-operator-lifecycle-event/v1'
        || typeof event.eventId !== 'string'
        || event.eventId.trim().length === 0
        || !exactFields(event.packRef, packRefFields)
        || !validActor(event.actor)
        || !validDate(event.createdAt)) {
      throw new Error('lifecycle_event_invalid');
    }
    if (!nonEmptyUniqueStrings(event.evidenceRefs)) throw new Error('lifecycle_evidence_required');
    if (event.actor.kind === 'AI') throw new Error('ai_lifecycle_transition_forbidden');
    if (['CALIBRATED', 'ACTIVE'].includes(event.toStatus) && event.actor.kind !== 'HUMAN') {
      throw new Error(`human_lifecycle_authority_required:${event.toStatus}`);
    }
    const currentStatus = this.getStatus(event.packRef);
    if (event.fromStatus !== currentStatus) throw new Error(`lifecycle_from_status_mismatch:${currentStatus}`);
    if (!lifecycleTransitions[currentStatus]?.includes(event.toStatus)) {
      throw new Error(`invalid_lifecycle_transition:${currentStatus}->${event.toStatus}`);
    }
    this.#database.prepare(`
      INSERT INTO registry_events (
        event_id, pack_id, version, digest, from_status, to_status,
        evidence_refs_json, actor_kind, actor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.packRef.packId,
      event.packRef.version,
      event.packRef.digest,
      event.fromStatus,
      event.toStatus,
      canonicalJson(event.evidenceRefs),
      event.actor.kind,
      event.actor.id,
      event.createdAt,
    );
    return structuredClone(event);
  }

  appendExperience(event, { providerManifest } = {}) {
    const validation = validateExperienceEvent(event);
    if (!validation.ok) throw new Error(validation.reason);
    const pack = this.getPack(event.packRef);
    const operator = pack.families
      .flatMap(family => family.variants)
      .find(variant => variant.operatorId === event.operatorRef.operatorId
        && variant.version === event.operatorRef.version);
    if (!operator) throw new Error('operator_experience_operator_not_found');
    const axes = new Map(pack.axes.map(axis => [axis.axisId, axis]));
    const seenAxes = new Set();
    for (const change of event.semanticContext.axisChanges) {
      if (seenAxes.has(change.axisId)) {
        throw new Error(`operator_experience_axis_duplicate:${change.axisId}`);
      }
      seenAxes.add(change.axisId);
      const axis = axes.get(change.axisId);
      if (!axis) throw new Error(`operator_experience_axis_not_found:${change.axisId}`);
      if (!valueMatchesSchema(change.value, axis.valueSchema)) {
        throw new Error(`operator_experience_axis_value_invalid:${change.axisId}`);
      }
      const supported = operator.effects.some(effect => (
        effect.axisId === change.axisId && effect.mode === change.mode
      ));
      if (!supported) {
        throw new Error(`operator_experience_effect_not_supported:${change.axisId}:${change.mode}`);
      }
    }
    const lockIds = new Set(pack.locks.map(lock => lock.lockId));
    const unknownLock = event.semanticContext.lockIds.find(lockId => !lockIds.has(lockId));
    if (unknownLock) throw new Error(`operator_experience_lock_not_found:${unknownLock}`);
    if (event.provenance.kind !== 'RUNTIME' && event.providerRef !== undefined) {
      throw new Error('operator_experience_provider_ref_forbidden_for_proposal');
    }
    if (event.provenance.kind === 'RUNTIME' && event.providerRef === undefined) {
      throw new Error('operator_experience_runtime_provider_ref_required');
    }
    if (event.provenance.kind === 'RUNTIME') {
      if (providerManifest === undefined) {
        throw new Error('operator_experience_runtime_manifest_required');
      }
      const manifestValidation = validateProviderCapabilityManifest(providerManifest);
      if (!manifestValidation.ok) {
        throw new Error(`operator_experience_runtime_manifest_invalid:${manifestValidation.reason}`);
      }
      if (providerManifest.providerId !== event.providerRef.providerId
          || providerManifest.providerVersion !== event.providerRef.providerVersion) {
        throw new Error('operator_experience_runtime_provider_mismatch');
      }
      const capability = providerManifest.operators.find(item => (
        item.operatorId === event.operatorRef.operatorId
        && item.versions.includes(event.operatorRef.version)
      ));
      if (!capability) throw new Error('operator_experience_runtime_operator_capability_missing');
    }
    this.#database.prepare(`
      INSERT INTO experience_events (
        event_id, operation_id, pack_id, version, digest, operator_id, operator_version,
        provider_id, provider_version, semantic_context_json, input_hashes_json,
        output_hashes_json, outcome, evaluation_refs_json, human_preference_ref,
        evidence_class, provenance_kind, provenance_id, failure_class, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.operationId,
      event.packRef.packId,
      event.packRef.version,
      event.packRef.digest,
      event.operatorRef.operatorId,
      event.operatorRef.version,
      event.providerRef?.providerId ?? null,
      event.providerRef?.providerVersion ?? null,
      canonicalJson(event.semanticContext),
      canonicalJson(event.inputHashes),
      canonicalJson(event.outputHashes),
      event.outcome,
      canonicalJson(event.evaluationRefs),
      event.humanPreferenceRef ?? null,
      event.evidenceClass,
      event.provenance.kind,
      event.provenance.id,
      event.failureClass ?? null,
      event.occurredAt,
    );
    return structuredClone(event);
  }

  listExperience({ operatorId, packId } = {}) {
    const clauses = [];
    const values = [];
    if (operatorId !== undefined) {
      clauses.push('operator_id = ?');
      values.push(operatorId);
    }
    if (packId !== undefined) {
      clauses.push('pack_id = ?');
      values.push(packId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.#database.prepare(`
      SELECT * FROM experience_events ${where} ORDER BY rowid
    `).all(...values);
    return rows.map(row => {
      const event = {
        schema: 'eve-atelier-operator-experience-event/v1',
        eventId: row.event_id,
        operationId: row.operation_id,
        packRef: { packId: row.pack_id, version: row.version, digest: row.digest },
        operatorRef: { operatorId: row.operator_id, version: row.operator_version },
        semanticContext: JSON.parse(row.semantic_context_json),
        inputHashes: JSON.parse(row.input_hashes_json),
        outputHashes: JSON.parse(row.output_hashes_json),
        outcome: row.outcome,
        evaluationRefs: JSON.parse(row.evaluation_refs_json),
        evidenceClass: row.evidence_class,
        provenance: { kind: row.provenance_kind, id: row.provenance_id },
        occurredAt: row.occurred_at,
      };
      if (row.provider_id !== null) {
        event.providerRef = { providerId: row.provider_id, providerVersion: row.provider_version };
      }
      if (row.human_preference_ref !== null) event.humanPreferenceRef = row.human_preference_ref;
      if (row.failure_class !== null) event.failureClass = row.failure_class;
      return event;
    });
  }

  close() {
    this.#database.close();
  }
}
