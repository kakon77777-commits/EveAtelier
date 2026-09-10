import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, digestDefinition } from '../operator-runtime/canonical.js';
import {
  isDenseJsonArray,
  isPlainJsonObject,
  normalizeCanonicalJsonValue,
} from '../operator-runtime/json-values.js';
import { isCanonicalInstant } from '../operator-runtime/time.js';
import {
  SAME_SERIES_DIMENSIONS,
  validateSameSeriesObservation,
} from './contracts.js';

const statuses = Object.freeze(['MATCH', 'DRIFT', 'UNKNOWN']);
const choices = Object.freeze(['LEFT', 'RIGHT', 'TIE', 'NEITHER']);
const actorKinds = Object.freeze(['HUMAN', 'AI', 'SYSTEM']);
const relationKinds = Object.freeze([
  'SAME_CHARACTER_EXACT_PAIR',
  'CROSS_CHARACTER_COUNTEREXAMPLE',
]);
const findingKinds = Object.freeze(['FALSE_POSITIVE', 'METRIC_BLINDNESS']);

const profileFields = Object.freeze([
  'schema', 'profileId', 'version', 'maturity', 'dimensions',
]);
const dimensionDefinitionFields = Object.freeze([
  'dimensionId', 'definitionVersion', 'description', 'allowedStatuses',
]);
const profileRefFields = Object.freeze(['profileId', 'version', 'digest']);
const actorFields = Object.freeze(['kind', 'id']);
const scopeFields = Object.freeze(['kind', 'projectId', 'taskId']);
const artifactFields = Object.freeze(['artifactId', 'sha256']);
const evaluatorFields = Object.freeze([
  'evaluatorId', 'evaluatorVersion', 'measurement', 'limits',
]);
const relationFields = Object.freeze(['kind', 'leftCharacterRef', 'rightCharacterRef']);
const artifactsFields = Object.freeze(['left', 'right', 'references']);
const dimensionObservationFields = Object.freeze([
  'dimensionId', 'definitionVersion', 'status', 'confidence',
  'evidenceRefs', 'notes', 'evaluator',
]);
const observationFields = Object.freeze([
  'schema', 'observationId', 'profileRef', 'stylePacketId', 'scope',
  'relation', 'artifacts', 'dimensions', 'recordedAt',
]);
const preferenceFields = Object.freeze([
  'schema', 'preferenceId', 'profileRef', 'observationId', 'scope',
  'roundId', 'observer', 'leftArtifact', 'rightArtifact', 'preferred',
  'reason', 'evidenceRefs', 'observedAt',
]);
const findingFields = Object.freeze([
  'schema', 'findingId', 'profileRef', 'scope', 'kind', 'observationIds',
  'evidenceRefs', 'rationale', 'reporter', 'recordedAt',
]);
const methodRefFields = Object.freeze(['methodId', 'version', 'parameterSetDigest']);
const thresholdCandidateFields = Object.freeze([
  'schema', 'candidateId', 'profileRef', 'scope', 'methodRef',
  'observationIds', 'preferenceIds', 'findingIds', 'evidenceRefs',
  'counterevidenceRefs', 'limitations', 'status', 'proposer', 'proposedAt',
]);

function isObject(value) {
  return isPlainJsonObject(value);
}

function exactFields(value, fields) {
  return isObject(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every(key => fields.includes(key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function semanticVersion(value) {
  return typeof value === 'string'
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function nonEmptyUniqueStrings(value) {
  return isDenseJsonArray(value)
    && value.length > 0
    && value.every(nonEmptyString)
    && new Set(value).size === value.length;
}

function exactStringArray(value, allowed) {
  return nonEmptyUniqueStrings(value) && value.every(item => allowed.includes(item));
}

function normalize(value, reason) {
  try {
    return normalizeCanonicalJsonValue(value);
  } catch {
    throw new Error(reason);
  }
}

function plainClone(value) {
  return JSON.parse(canonicalJson(value));
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function validateProfileRef(value) {
  return exactFields(value, profileRefFields)
    && nonEmptyString(value.profileId)
    && semanticVersion(value.version)
    && sha256(value.digest);
}

function validateActor(value, allowedKinds = actorKinds) {
  return exactFields(value, actorFields)
    && allowedKinds.includes(value.kind)
    && nonEmptyString(value.id);
}

function validateScope(value) {
  return exactFields(value, scopeFields)
    && value.kind === 'PROJECT_LOCAL'
    && nonEmptyString(value.projectId)
    && nonEmptyString(value.taskId);
}

function validateArtifact(value) {
  if (!isObject(value)) return 'calibration_artifact_required';
  const unknown = Object.keys(value).find(key => !artifactFields.includes(key));
  if (unknown) return `calibration_artifact_field_forbidden:${unknown}`;
  if (!exactFields(value, artifactFields)
      || !nonEmptyString(value.artifactId)
      || !sha256(value.sha256)) {
    return 'calibration_artifact_invalid';
  }
  return null;
}

function validateEvaluator(value) {
  return exactFields(value, evaluatorFields)
    && nonEmptyString(value.evaluatorId)
    && semanticVersion(value.evaluatorVersion)
    && nonEmptyString(value.measurement)
    && nonEmptyUniqueStrings(value.limits);
}

function forbiddenPublicString(value) {
  return typeof value === 'string'
    && (/[A-Za-z]:[\\/]/.test(value)
      || /(?:^|\s)\\\\[^\\]/.test(value)
      || /(?:file|https?|data):\/\//i.test(value));
}

function publicSafe(value) {
  if (typeof value === 'string') return !forbiddenPublicString(value);
  if (Array.isArray(value)) return value.every(publicSafe);
  if (isObject(value)) return Object.values(value).every(publicSafe);
  return true;
}

export function validateCalibrationProfile(value) {
  if (!exactFields(value, profileFields)) {
    return { ok: false, reason: 'calibration_profile_invalid' };
  }
  if (value.schema !== 'eve-atelier-same-series-dimension-profile/v1') {
    return { ok: false, reason: 'unsupported_calibration_profile_schema' };
  }
  if (!nonEmptyString(value.profileId) || !semanticVersion(value.version)) {
    return { ok: false, reason: 'calibration_profile_identity_invalid' };
  }
  if (value.maturity !== 'EXPERIMENTAL_UNCALIBRATED') {
    return { ok: false, reason: 'calibration_profile_maturity_invalid' };
  }
  if (!isDenseJsonArray(value.dimensions) || value.dimensions.length === 0) {
    return { ok: false, reason: 'calibration_profile_dimensions_required' };
  }
  const seen = new Set();
  for (const definition of value.dimensions) {
    if (!exactFields(definition, dimensionDefinitionFields)
        || !nonEmptyString(definition.dimensionId)
        || !semanticVersion(definition.definitionVersion)
        || !nonEmptyString(definition.description)
        || !exactStringArray(definition.allowedStatuses, statuses)) {
      return { ok: false, reason: 'calibration_dimension_definition_invalid' };
    }
    if (seen.has(definition.dimensionId)) {
      return {
        ok: false,
        reason: `calibration_dimension_definition_duplicate:${definition.dimensionId}`,
      };
    }
    seen.add(definition.dimensionId);
  }
  const missingCore = SAME_SERIES_DIMENSIONS.find(dimensionId => !seen.has(dimensionId));
  if (missingCore) {
    return { ok: false, reason: `calibration_core_dimension_required:${missingCore}` };
  }
  if (!publicSafe(value)) return { ok: false, reason: 'calibration_profile_public_safety_invalid' };
  return { ok: true };
}

export function validateCalibrationObservation(value) {
  if (!exactFields(value, observationFields)) {
    return { ok: false, reason: 'calibration_observation_invalid' };
  }
  if (value.schema !== 'eve-atelier-calibration-observation/v1') {
    return { ok: false, reason: 'unsupported_calibration_observation_schema' };
  }
  if (!nonEmptyString(value.observationId)
      || !validateProfileRef(value.profileRef)
      || !nonEmptyString(value.stylePacketId)
      || !validateScope(value.scope)) {
    return { ok: false, reason: 'calibration_observation_identity_invalid' };
  }
  if (!exactFields(value.relation, relationFields)
      || !relationKinds.includes(value.relation.kind)
      || !nonEmptyString(value.relation.leftCharacterRef)
      || !nonEmptyString(value.relation.rightCharacterRef)) {
    return { ok: false, reason: 'calibration_observation_relation_invalid' };
  }
  if (value.relation.kind === 'SAME_CHARACTER_EXACT_PAIR'
      && value.relation.leftCharacterRef !== value.relation.rightCharacterRef) {
    return { ok: false, reason: 'calibration_same_character_binding_mismatch' };
  }
  if (value.relation.kind === 'CROSS_CHARACTER_COUNTEREXAMPLE'
      && value.relation.leftCharacterRef === value.relation.rightCharacterRef) {
    return { ok: false, reason: 'calibration_counterexample_distinct_characters_required' };
  }
  if (!exactFields(value.artifacts, artifactsFields)) {
    return { ok: false, reason: 'calibration_observation_artifacts_invalid' };
  }
  for (const artifactValue of [value.artifacts.left, value.artifacts.right]) {
    const failure = validateArtifact(artifactValue);
    if (failure) return { ok: false, reason: failure };
  }
  if (!isDenseJsonArray(value.artifacts.references) || value.artifacts.references.length === 0) {
    return { ok: false, reason: 'calibration_observation_references_required' };
  }
  for (const reference of value.artifacts.references) {
    const failure = validateArtifact(reference);
    if (failure) return { ok: false, reason: failure };
  }
  if (value.artifacts.left.artifactId === value.artifacts.right.artifactId
      || value.artifacts.left.sha256.toLowerCase() === value.artifacts.right.sha256.toLowerCase()) {
    return { ok: false, reason: 'calibration_observation_distinct_artifacts_required' };
  }
  if (!isDenseJsonArray(value.dimensions) || value.dimensions.length === 0) {
    return { ok: false, reason: 'calibration_observation_dimensions_required' };
  }
  const seen = new Set();
  for (const dimension of value.dimensions) {
    if (!exactFields(dimension, dimensionObservationFields)
        || !nonEmptyString(dimension.dimensionId)
        || !semanticVersion(dimension.definitionVersion)
        || !statuses.includes(dimension.status)
        || !Number.isFinite(dimension.confidence)
        || dimension.confidence < 0
        || dimension.confidence > 1
        || !nonEmptyUniqueStrings(dimension.evidenceRefs)
        || !nonEmptyString(dimension.notes)
        || !validateEvaluator(dimension.evaluator)) {
      return { ok: false, reason: 'calibration_dimension_observation_invalid' };
    }
    if (seen.has(dimension.dimensionId)) {
      return { ok: false, reason: `calibration_dimension_duplicate:${dimension.dimensionId}` };
    }
    seen.add(dimension.dimensionId);
  }
  if (!isCanonicalInstant(value.recordedAt)) {
    return { ok: false, reason: 'calibration_observation_recorded_at_invalid' };
  }
  if (!publicSafe(value)) {
    return { ok: false, reason: 'calibration_observation_public_safety_invalid' };
  }
  return { ok: true };
}

export function validateCalibrationPreference(value) {
  if (!exactFields(value, preferenceFields)) {
    return { ok: false, reason: 'calibration_preference_invalid' };
  }
  if (value.schema !== 'eve-atelier-calibration-preference/v1') {
    return { ok: false, reason: 'unsupported_calibration_preference_schema' };
  }
  if (!nonEmptyString(value.preferenceId)
      || !validateProfileRef(value.profileRef)
      || !nonEmptyString(value.observationId)
      || !validateScope(value.scope)
      || !nonEmptyString(value.roundId)
      || !validateActor(value.observer, ['HUMAN'])
      || !choices.includes(value.preferred)
      || !nonEmptyString(value.reason)
      || !nonEmptyUniqueStrings(value.evidenceRefs)
      || !isCanonicalInstant(value.observedAt)) {
    return { ok: false, reason: 'calibration_preference_invalid' };
  }
  for (const artifactValue of [value.leftArtifact, value.rightArtifact]) {
    const failure = validateArtifact(artifactValue);
    if (failure) return { ok: false, reason: failure };
  }
  if (!publicSafe(value)) {
    return { ok: false, reason: 'calibration_preference_public_safety_invalid' };
  }
  return { ok: true };
}

export function validateCalibrationFinding(value) {
  if (!exactFields(value, findingFields)
      || value.schema !== 'eve-atelier-calibration-finding/v1'
      || !nonEmptyString(value.findingId)
      || !validateProfileRef(value.profileRef)
      || !validateScope(value.scope)
      || !findingKinds.includes(value.kind)
      || !nonEmptyUniqueStrings(value.observationIds)
      || !nonEmptyUniqueStrings(value.evidenceRefs)
      || !nonEmptyString(value.rationale)
      || !validateActor(value.reporter)
      || !isCanonicalInstant(value.recordedAt)) {
    return { ok: false, reason: 'calibration_finding_invalid' };
  }
  if (!publicSafe(value)) return { ok: false, reason: 'calibration_finding_public_safety_invalid' };
  return { ok: true };
}

export function validateThresholdCandidate(value) {
  if (!exactFields(value, thresholdCandidateFields)
      || value.schema !== 'eve-atelier-threshold-candidate/v1'
      || !nonEmptyString(value.candidateId)
      || !validateProfileRef(value.profileRef)
      || !validateScope(value.scope)
      || !exactFields(value.methodRef, methodRefFields)
      || !nonEmptyString(value.methodRef.methodId)
      || !semanticVersion(value.methodRef.version)
      || !sha256(value.methodRef.parameterSetDigest)
      || !nonEmptyUniqueStrings(value.observationIds)
      || !nonEmptyUniqueStrings(value.preferenceIds)
      || !nonEmptyUniqueStrings(value.findingIds)
      || !nonEmptyUniqueStrings(value.evidenceRefs)
      || !nonEmptyUniqueStrings(value.counterevidenceRefs)
      || !nonEmptyUniqueStrings(value.limitations)
      || value.status !== 'PROPOSED'
      || !validateActor(value.proposer)
      || !isCanonicalInstant(value.proposedAt)) {
    return { ok: false, reason: 'threshold_candidate_invalid' };
  }
  if (!publicSafe(value)) return { ok: false, reason: 'threshold_candidate_public_safety_invalid' };
  return { ok: true };
}

export function adaptSameSeriesObservation({ profile, relation, observation } = {}) {
  profile = normalize(profile, 'calibration_profile_json_value_invalid');
  relation = normalize(relation, 'calibration_observation_json_value_invalid');
  observation = normalize(observation, 'same_series_observation_json_value_invalid');
  const profileValidation = validateCalibrationProfile(profile);
  if (!profileValidation.ok) throw new Error(profileValidation.reason);
  const legacyValidation = validateSameSeriesObservation(observation);
  if (!legacyValidation.ok) throw new Error(legacyValidation.reason);
  if (profile.dimensions.length !== SAME_SERIES_DIMENSIONS.length) {
    throw new Error('legacy_same_series_profile_dimension_mismatch');
  }
  const definitions = new Map(profile.dimensions.map(item => [item.dimensionId, item]));
  const missing = SAME_SERIES_DIMENSIONS.find(dimensionId => !definitions.has(dimensionId));
  if (missing) throw new Error(`legacy_same_series_profile_dimension_missing:${missing}`);

  const result = {
    schema: 'eve-atelier-calibration-observation/v1',
    observationId: observation.observationId,
    profileRef: {
      profileId: profile.profileId,
      version: profile.version,
      digest: digestDefinition(profile),
    },
    stylePacketId: observation.stylePacketId,
    scope: plainClone(observation.scope),
    relation: plainClone(relation),
    artifacts: {
      left: plainClone(observation.source),
      right: plainClone(observation.candidate),
      references: plainClone(observation.references),
    },
    dimensions: SAME_SERIES_DIMENSIONS.map(dimensionId => ({
      dimensionId,
      definitionVersion: definitions.get(dimensionId).definitionVersion,
      status: observation.dimensions[dimensionId].status,
      confidence: observation.dimensions[dimensionId].confidence,
      evidenceRefs: plainClone(observation.dimensions[dimensionId].evidenceRefs),
      notes: observation.dimensions[dimensionId].notes,
      evaluator: plainClone(observation.evaluator),
    })),
    recordedAt: observation.createdAt,
  };
  const validation = validateCalibrationObservation(result);
  if (!validation.ok) throw new Error(validation.reason);
  return result;
}

function sqliteTriggers(table, identityCondition) {
  return `
    CREATE TRIGGER IF NOT EXISTS ${table}_no_update
    BEFORE UPDATE ON ${table}
    BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
    CREATE TRIGGER IF NOT EXISTS ${table}_no_delete
    BEFORE DELETE ON ${table}
    BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;
    CREATE TRIGGER IF NOT EXISTS ${table}_no_replace
    BEFORE INSERT ON ${table}
    WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${identityCondition})
    BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
  `;
}

export class CalibrationEvidenceStore {
  #database;

  constructor({ path = ':memory:' } = {}) {
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS calibration_profiles (
        profile_id TEXT NOT NULL,
        version TEXT NOT NULL,
        digest TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        proposer_kind TEXT NOT NULL,
        proposer_id TEXT NOT NULL,
        PRIMARY KEY (profile_id, version),
        UNIQUE (profile_id, version, digest)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS calibration_observations (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        observation_id TEXT NOT NULL UNIQUE,
        profile_id TEXT NOT NULL,
        profile_version TEXT NOT NULL,
        profile_digest TEXT NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        relation_kind TEXT NOT NULL,
        record_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY (profile_id, profile_version, profile_digest)
          REFERENCES calibration_profiles(profile_id, version, digest)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS calibration_preferences (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        preference_id TEXT NOT NULL UNIQUE,
        profile_id TEXT NOT NULL,
        profile_version TEXT NOT NULL,
        profile_digest TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        observer_id TEXT NOT NULL,
        preferred TEXT NOT NULL,
        record_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        UNIQUE (observation_id, round_id, observer_id),
        FOREIGN KEY (profile_id, profile_version, profile_digest)
          REFERENCES calibration_profiles(profile_id, version, digest),
        FOREIGN KEY (observation_id) REFERENCES calibration_observations(observation_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS calibration_findings (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        finding_id TEXT NOT NULL UNIQUE,
        profile_id TEXT NOT NULL,
        profile_version TEXT NOT NULL,
        profile_digest TEXT NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        finding_kind TEXT NOT NULL,
        record_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY (profile_id, profile_version, profile_digest)
          REFERENCES calibration_profiles(profile_id, version, digest)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS threshold_candidates (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL UNIQUE,
        profile_id TEXT NOT NULL,
        profile_version TEXT NOT NULL,
        profile_digest TEXT NOT NULL,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status = 'PROPOSED'),
        record_json TEXT NOT NULL,
        proposed_at TEXT NOT NULL,
        FOREIGN KEY (profile_id, profile_version, profile_digest)
          REFERENCES calibration_profiles(profile_id, version, digest)
      ) STRICT;

      ${sqliteTriggers(
        'calibration_profiles',
        'profile_id = NEW.profile_id AND version = NEW.version',
      )}
      ${sqliteTriggers('calibration_observations', 'observation_id = NEW.observation_id')}
      ${sqliteTriggers('calibration_preferences', 'preference_id = NEW.preference_id')}
      ${sqliteTriggers('calibration_findings', 'finding_id = NEW.finding_id')}
      ${sqliteTriggers('threshold_candidates', 'candidate_id = NEW.candidate_id')}
    `);
  }

  registerProfile({ profile, proposer, registeredAt } = {}) {
    profile = normalize(profile, 'calibration_profile_json_value_invalid');
    proposer = normalize(proposer, 'calibration_profile_proposer_invalid');
    const validation = validateCalibrationProfile(profile);
    if (!validation.ok) throw new Error(validation.reason);
    if (!validateActor(proposer)) throw new Error('calibration_profile_proposer_invalid');
    if (!isCanonicalInstant(registeredAt)) throw new Error('calibration_profile_registered_at_invalid');
    const digest = digestDefinition(profile);
    const existing = this.#database.prepare(`
      SELECT digest FROM calibration_profiles WHERE profile_id = ? AND version = ?
    `).get(profile.profileId, profile.version);
    if (existing) {
      if (existing.digest !== digest) throw new Error('calibration_profile_version_conflict');
      return { profileId: profile.profileId, version: profile.version, digest };
    }
    this.#database.prepare(`
      INSERT INTO calibration_profiles (
        profile_id, version, digest, definition_json, registered_at, proposer_kind, proposer_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.profileId,
      profile.version,
      digest,
      canonicalJson(profile),
      registeredAt,
      proposer.kind,
      proposer.id,
    );
    return { profileId: profile.profileId, version: profile.version, digest };
  }

  getProfile({ profileId, version, digest } = {}) {
    const row = this.#database.prepare(`
      SELECT digest, definition_json FROM calibration_profiles
      WHERE profile_id = ? AND version = ?
    `).get(profileId, version);
    if (!row) throw new Error('calibration_profile_not_found');
    if (digest !== undefined && digest !== row.digest) throw new Error('calibration_profile_digest_mismatch');
    return JSON.parse(row.definition_json);
  }

  #profileRef(value) {
    if (!validateProfileRef(value)) throw new Error('calibration_profile_ref_invalid');
    this.getProfile(value);
    return value;
  }

  appendObservation(value) {
    value = normalize(value, 'calibration_observation_json_value_invalid');
    const validation = validateCalibrationObservation(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#profileRef(value.profileRef);
    const profile = this.getProfile(value.profileRef);
    const definitions = new Map(profile.dimensions.map(item => [item.dimensionId, item]));
    if (value.dimensions.length !== definitions.size) {
      throw new Error('calibration_observation_profile_dimension_mismatch');
    }
    for (const dimension of value.dimensions) {
      const definition = definitions.get(dimension.dimensionId);
      if (!definition) throw new Error(`calibration_observation_dimension_not_found:${dimension.dimensionId}`);
      if (definition.definitionVersion !== dimension.definitionVersion) {
        throw new Error(`calibration_observation_definition_version_mismatch:${dimension.dimensionId}`);
      }
      if (!definition.allowedStatuses.includes(dimension.status)) {
        throw new Error(`calibration_observation_status_not_allowed:${dimension.dimensionId}`);
      }
      definitions.delete(dimension.dimensionId);
    }
    if (definitions.size > 0) {
      throw new Error(`calibration_observation_dimension_missing:${definitions.keys().next().value}`);
    }
    const existing = this.#database.prepare(`
      SELECT record_json FROM calibration_observations WHERE observation_id = ?
    `).get(value.observationId);
    if (existing) {
      const retained = JSON.parse(existing.record_json);
      if (!sameJson(retained, value)) throw new Error('calibration_observation_id_conflict');
      return retained;
    }
    this.#database.prepare(`
      INSERT INTO calibration_observations (
        observation_id, profile_id, profile_version, profile_digest,
        project_id, task_id, relation_kind, record_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.observationId,
      value.profileRef.profileId,
      value.profileRef.version,
      value.profileRef.digest,
      value.scope.projectId,
      value.scope.taskId,
      value.relation.kind,
      canonicalJson(value),
      value.recordedAt,
    );
    return plainClone(value);
  }

  getObservation(observationId) {
    const row = this.#database.prepare(`
      SELECT record_json FROM calibration_observations WHERE observation_id = ?
    `).get(observationId);
    if (!row) throw new Error('calibration_observation_not_found');
    return JSON.parse(row.record_json);
  }

  appendPreference(value) {
    value = normalize(value, 'calibration_preference_json_value_invalid');
    const validation = validateCalibrationPreference(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#profileRef(value.profileRef);
    const observation = this.getObservation(value.observationId);
    if (!sameJson(value.profileRef, observation.profileRef)) {
      throw new Error('calibration_preference_profile_mismatch');
    }
    if (!sameJson(value.scope, observation.scope)) throw new Error('calibration_preference_scope_mismatch');
    const suppliedPair = [value.leftArtifact, value.rightArtifact].map(canonicalJson).sort();
    const observedPair = [observation.artifacts.left, observation.artifacts.right]
      .map(canonicalJson).sort();
    if (!sameJson(suppliedPair, observedPair)) throw new Error('calibration_preference_pair_mismatch');
    if (Date.parse(value.observedAt) < Date.parse(observation.recordedAt)) {
      throw new Error('calibration_preference_before_observation');
    }
    const existing = this.#database.prepare(`
      SELECT record_json FROM calibration_preferences WHERE preference_id = ?
    `).get(value.preferenceId);
    if (existing) {
      const retained = JSON.parse(existing.record_json);
      if (!sameJson(retained, value)) throw new Error('calibration_preference_id_conflict');
      return retained;
    }
    const observerRound = this.#database.prepare(`
      SELECT preference_id FROM calibration_preferences
      WHERE observation_id = ? AND round_id = ? AND observer_id = ?
    `).get(value.observationId, value.roundId, value.observer.id);
    if (observerRound) throw new Error('calibration_preference_observer_round_conflict');
    this.#database.prepare(`
      INSERT INTO calibration_preferences (
        preference_id, profile_id, profile_version, profile_digest,
        observation_id, project_id, task_id, round_id, observer_id,
        preferred, record_json, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.preferenceId,
      value.profileRef.profileId,
      value.profileRef.version,
      value.profileRef.digest,
      value.observationId,
      value.scope.projectId,
      value.scope.taskId,
      value.roundId,
      value.observer.id,
      value.preferred,
      canonicalJson(value),
      value.observedAt,
    );
    return plainClone(value);
  }

  listPreferences({ observationId } = {}) {
    const rows = observationId === undefined
      ? this.#database.prepare(`
          SELECT record_json FROM calibration_preferences ORDER BY event_sequence
        `).all()
      : this.#database.prepare(`
          SELECT record_json FROM calibration_preferences
          WHERE observation_id = ? ORDER BY event_sequence
        `).all(observationId);
    return rows.map(row => JSON.parse(row.record_json));
  }

  summarizePreferences({ observationId } = {}) {
    this.getObservation(observationId);
    const events = this.listPreferences({ observationId });
    const grouped = new Map();
    for (const event of events) {
      if (!grouped.has(event.roundId)) grouped.set(event.roundId, []);
      grouped.get(event.roundId).push(event);
    }
    return {
      schema: 'eve-atelier-calibration-preference-summary/v1',
      observationId,
      rounds: [...grouped].map(([roundId, roundEvents]) => {
        const counts = { LEFT: 0, RIGHT: 0, TIE: 0, NEITHER: 0 };
        for (const event of roundEvents) counts[event.preferred] += 1;
        return {
          roundId,
          choices: counts,
          disagreement: Object.values(counts).filter(count => count > 0).length > 1,
        };
      }),
      authorizesCalibration: false,
    };
  }

  appendFinding(value) {
    value = normalize(value, 'calibration_finding_json_value_invalid');
    const validation = validateCalibrationFinding(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#profileRef(value.profileRef);
    let latestObservationAt = Number.NEGATIVE_INFINITY;
    for (const observationId of value.observationIds) {
      let observation;
      try {
        observation = this.getObservation(observationId);
      } catch {
        throw new Error(`calibration_finding_observation_not_found:${observationId}`);
      }
      if (!sameJson(observation.profileRef, value.profileRef)) {
        throw new Error(`calibration_finding_profile_mismatch:${observationId}`);
      }
      if (!sameJson(observation.scope, value.scope)) {
        throw new Error(`calibration_finding_scope_mismatch:${observationId}`);
      }
      latestObservationAt = Math.max(latestObservationAt, Date.parse(observation.recordedAt));
    }
    if (Date.parse(value.recordedAt) <= latestObservationAt) {
      throw new Error('calibration_finding_not_after_observations');
    }
    const existing = this.#database.prepare(`
      SELECT record_json FROM calibration_findings WHERE finding_id = ?
    `).get(value.findingId);
    if (existing) {
      const retained = JSON.parse(existing.record_json);
      if (!sameJson(retained, value)) throw new Error('calibration_finding_id_conflict');
      return retained;
    }
    this.#database.prepare(`
      INSERT INTO calibration_findings (
        finding_id, profile_id, profile_version, profile_digest,
        project_id, task_id, finding_kind, record_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.findingId,
      value.profileRef.profileId,
      value.profileRef.version,
      value.profileRef.digest,
      value.scope.projectId,
      value.scope.taskId,
      value.kind,
      canonicalJson(value),
      value.recordedAt,
    );
    return plainClone(value);
  }

  listFindings({ profileRef } = {}) {
    const rows = profileRef === undefined
      ? this.#database.prepare(`
          SELECT record_json FROM calibration_findings ORDER BY event_sequence
        `).all()
      : this.#database.prepare(`
          SELECT record_json FROM calibration_findings
          WHERE profile_id = ? AND profile_version = ? AND profile_digest = ?
          ORDER BY event_sequence
        `).all(profileRef.profileId, profileRef.version, profileRef.digest);
    return rows.map(row => JSON.parse(row.record_json));
  }

  appendThresholdCandidate(value) {
    value = normalize(value, 'threshold_candidate_json_value_invalid');
    const validation = validateThresholdCandidate(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#profileRef(value.profileRef);
    const observations = value.observationIds.map(observationId => {
      try {
        return this.getObservation(observationId);
      } catch {
        throw new Error(`threshold_candidate_observation_not_found:${observationId}`);
      }
    });
    for (const observation of observations) {
      if (!sameJson(observation.profileRef, value.profileRef)
          || !sameJson(observation.scope, value.scope)) {
        throw new Error(`threshold_candidate_observation_scope_mismatch:${observation.observationId}`);
      }
    }
    for (const requiredKind of relationKinds) {
      if (!observations.some(observation => observation.relation.kind === requiredKind)) {
        throw new Error(`threshold_candidate_relation_evidence_required:${requiredKind}`);
      }
    }
    const observationIdSet = new Set(value.observationIds);
    const preferenceRows = value.preferenceIds.map(preferenceId => {
      const row = this.#database.prepare(`
        SELECT record_json FROM calibration_preferences WHERE preference_id = ?
      `).get(preferenceId);
      if (!row) throw new Error(`threshold_candidate_preference_not_found:${preferenceId}`);
      return JSON.parse(row.record_json);
    });
    const roundsByObservation = new Map();
    for (const preferenceValue of preferenceRows) {
      if (!sameJson(preferenceValue.profileRef, value.profileRef)
          || !sameJson(preferenceValue.scope, value.scope)) {
        throw new Error(`threshold_candidate_preference_scope_mismatch:${preferenceValue.preferenceId}`);
      }
      if (!observationIdSet.has(preferenceValue.observationId)) {
        throw new Error(`threshold_candidate_preference_observation_unbound:${preferenceValue.preferenceId}`);
      }
      if (!roundsByObservation.has(preferenceValue.observationId)) {
        roundsByObservation.set(preferenceValue.observationId, new Set());
      }
      roundsByObservation.get(preferenceValue.observationId).add(preferenceValue.roundId);
    }
    if (![...roundsByObservation.values()].some(rounds => rounds.size >= 2)) {
      throw new Error('threshold_candidate_repeated_preference_rounds_required');
    }
    const findingRows = [];
    for (const findingId of value.findingIds) {
      const row = this.#database.prepare(`
        SELECT record_json FROM calibration_findings WHERE finding_id = ?
      `).get(findingId);
      if (!row) throw new Error(`threshold_candidate_finding_not_found:${findingId}`);
      const findingValue = JSON.parse(row.record_json);
      if (!sameJson(findingValue.profileRef, value.profileRef)
          || !sameJson(findingValue.scope, value.scope)) {
        throw new Error(`threshold_candidate_finding_scope_mismatch:${findingId}`);
      }
      const unboundObservation = findingValue.observationIds.find(
        observationId => !observationIdSet.has(observationId),
      );
      if (unboundObservation) {
        throw new Error(`threshold_candidate_finding_observation_unbound:${findingId}:${unboundObservation}`);
      }
      findingRows.push(findingValue);
    }
    const latestEvidenceAt = Math.max(
      ...observations.map(item => Date.parse(item.recordedAt)),
      ...preferenceRows.map(item => Date.parse(item.observedAt)),
      ...findingRows.map(item => Date.parse(item.recordedAt)),
    );
    if (Date.parse(value.proposedAt) <= latestEvidenceAt) {
      throw new Error('threshold_candidate_not_after_evidence');
    }
    const existing = this.#database.prepare(`
      SELECT record_json FROM threshold_candidates WHERE candidate_id = ?
    `).get(value.candidateId);
    if (existing) {
      const retained = JSON.parse(existing.record_json);
      if (!sameJson(retained, value)) throw new Error('threshold_candidate_id_conflict');
      return retained;
    }
    this.#database.prepare(`
      INSERT INTO threshold_candidates (
        candidate_id, profile_id, profile_version, profile_digest,
        project_id, task_id, status, record_json, proposed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.candidateId,
      value.profileRef.profileId,
      value.profileRef.version,
      value.profileRef.digest,
      value.scope.projectId,
      value.scope.taskId,
      value.status,
      canonicalJson(value),
      value.proposedAt,
    );
    return plainClone(value);
  }

  listThresholdCandidates({ profileRef } = {}) {
    const rows = profileRef === undefined
      ? this.#database.prepare(`
          SELECT record_json FROM threshold_candidates ORDER BY event_sequence
        `).all()
      : this.#database.prepare(`
          SELECT record_json FROM threshold_candidates
          WHERE profile_id = ? AND profile_version = ? AND profile_digest = ?
          ORDER BY event_sequence
        `).all(profileRef.profileId, profileRef.version, profileRef.digest);
    return rows.map(row => JSON.parse(row.record_json));
  }

  summarizeEvidence({ profileRef, scope } = {}) {
    this.#profileRef(profileRef);
    if (!validateScope(scope)) throw new Error('calibration_summary_scope_invalid');
    const observations = this.#database.prepare(`
      SELECT observation_id, relation_kind, record_json FROM calibration_observations
      WHERE profile_id = ? AND profile_version = ? AND profile_digest = ?
        AND project_id = ? AND task_id = ?
      ORDER BY event_sequence
    `).all(
      profileRef.profileId,
      profileRef.version,
      profileRef.digest,
      scope.projectId,
      scope.taskId,
    );
    const observationIds = new Set(observations.map(row => row.observation_id));
    const pairKeys = {
      SAME_CHARACTER_EXACT_PAIR: new Set(),
      CROSS_CHARACTER_COUNTEREXAMPLE: new Set(),
    };
    for (const row of observations) {
      const observation = JSON.parse(row.record_json);
      const pairKey = [observation.artifacts.left, observation.artifacts.right]
        .map(canonicalJson)
        .sort()
        .join('\u0000');
      pairKeys[row.relation_kind].add(pairKey);
    }
    const preferenceEvents = this.listPreferences()
      .filter(event => observationIds.has(event.observationId));
    const roundGroups = new Map();
    for (const event of preferenceEvents) {
      const key = `${event.observationId}\u0000${event.roundId}`;
      if (!roundGroups.has(key)) roundGroups.set(key, new Set());
      roundGroups.get(key).add(event.preferred);
    }
    const findingRows = this.#database.prepare(`
      SELECT finding_kind FROM calibration_findings
      WHERE profile_id = ? AND profile_version = ? AND profile_digest = ?
        AND project_id = ? AND task_id = ?
    `).all(
      profileRef.profileId,
      profileRef.version,
      profileRef.digest,
      scope.projectId,
      scope.taskId,
    );
    const thresholdCount = this.#database.prepare(`
      SELECT COUNT(*) AS count FROM threshold_candidates
      WHERE profile_id = ? AND profile_version = ? AND profile_digest = ?
        AND project_id = ? AND task_id = ?
    `).get(
      profileRef.profileId,
      profileRef.version,
      profileRef.digest,
      scope.projectId,
      scope.taskId,
    ).count;
    return {
      schema: 'eve-atelier-calibration-evidence-summary/v1',
      profileRef: plainClone(profileRef),
      scope: plainClone(scope),
      counts: {
        sameCharacterExactPairs: pairKeys.SAME_CHARACTER_EXACT_PAIR.size,
        crossCharacterCounterexamples: pairKeys.CROSS_CHARACTER_COUNTEREXAMPLE.size,
        preferenceRounds: roundGroups.size,
        disagreementRounds: [...roundGroups.values()].filter(set => set.size > 1).length,
        falsePositiveFindings: findingRows.filter(
          row => row.finding_kind === 'FALSE_POSITIVE',
        ).length,
        metricBlindnessFindings: findingRows.filter(
          row => row.finding_kind === 'METRIC_BLINDNESS',
        ).length,
        thresholdCandidates: Number(thresholdCount),
      },
      calibrationStatus: 'EXPERIMENTAL_UNCALIBRATED',
      authority: {
        calibration: false,
        activation: false,
        visualAcceptance: false,
        workbenchPromotion: false,
        mrmicMutation: false,
      },
    };
  }

  close() {
    this.#database.close();
  }
}
