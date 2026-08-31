import { canonicalJson } from './canonical.js';
import {
  validateCounterfactualObservation,
  validateCounterfactualPrediction,
  validateOperatorProposal,
} from './contracts.js';
import { valueMatchesSchema } from './semantic-values.js';

function allOperators(pack) {
  return pack.families.flatMap(family => family.variants);
}

function operatorKey(ref) {
  return `${ref.operatorId}@${ref.version}`;
}

function compareDelta(predicted, observed) {
  if (!observed || predicted.direction === 'UNKNOWN' || predicted.magnitude === 'UNKNOWN'
      || observed.direction === 'UNKNOWN' || observed.magnitude === 'UNKNOWN') {
    return 'UNRESOLVED';
  }
  if (predicted.direction !== observed.direction) return 'MISMATCH';
  if (predicted.magnitude !== observed.magnitude) return 'PARTIAL';
  return 'MATCH';
}

export class VusdEvidenceStore {
  #database;
  #resolvePack;

  constructor({ database, resolvePack } = {}) {
    if (!database || typeof database.exec !== 'function' || typeof database.prepare !== 'function') {
      throw new TypeError('vusd_evidence_database_required');
    }
    if (typeof resolvePack !== 'function') throw new TypeError('vusd_pack_resolver_required');
    this.#database = database;
    this.#resolvePack = resolvePack;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS counterfactual_predictions (
        prediction_id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        version TEXT NOT NULL,
        digest TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        operator_version TEXT NOT NULL,
        artifact_before_id TEXT NOT NULL,
        artifact_before_sha256 TEXT NOT NULL,
        intervention_json TEXT NOT NULL,
        predicted_deltas_json TEXT NOT NULL,
        scope_refs_json TEXT NOT NULL,
        rationale_refs_json TEXT NOT NULL,
        alternative_rationale_refs_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        evidence_class TEXT NOT NULL,
        provenance_kind TEXT NOT NULL,
        provenance_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY (pack_id, version) REFERENCES operator_packs(pack_id, version)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS counterfactual_observations (
        observation_id TEXT PRIMARY KEY,
        prediction_id TEXT NOT NULL,
        artifact_after_id TEXT NOT NULL,
        artifact_after_sha256 TEXT NOT NULL,
        observed_deltas_json TEXT NOT NULL,
        collateral_deltas_json TEXT NOT NULL,
        evaluation_refs_json TEXT NOT NULL,
        limitation_refs_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        evidence_class TEXT NOT NULL,
        provenance_kind TEXT NOT NULL,
        provenance_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY (prediction_id) REFERENCES counterfactual_predictions(prediction_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS operator_proposals (
        proposal_id TEXT PRIMARY KEY,
        base_pack_id TEXT NOT NULL,
        base_version TEXT NOT NULL,
        base_digest TEXT NOT NULL,
        proposed_operator_id TEXT NOT NULL,
        proposed_operator_version TEXT NOT NULL,
        decomposition_json TEXT NOT NULL,
        scope_refs_json TEXT NOT NULL,
        residual_refs_json TEXT NOT NULL,
        rationale_refs_json TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        counterevidence_refs_json TEXT NOT NULL,
        provenance_kind TEXT NOT NULL,
        provenance_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY (base_pack_id, base_version) REFERENCES operator_packs(pack_id, version)
      ) STRICT;

      CREATE TRIGGER IF NOT EXISTS counterfactual_predictions_no_update
      BEFORE UPDATE ON counterfactual_predictions
      BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS counterfactual_predictions_no_delete
      BEFORE DELETE ON counterfactual_predictions
      BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS counterfactual_observations_no_update
      BEFORE UPDATE ON counterfactual_observations
      BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS counterfactual_observations_no_delete
      BEFORE DELETE ON counterfactual_observations
      BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS operator_proposals_no_update
      BEFORE UPDATE ON operator_proposals
      BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS operator_proposals_no_delete
      BEFORE DELETE ON operator_proposals
      BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;

      CREATE TRIGGER IF NOT EXISTS counterfactual_predictions_no_replace
      BEFORE INSERT ON counterfactual_predictions
      WHEN EXISTS (
        SELECT 1 FROM counterfactual_predictions WHERE prediction_id = NEW.prediction_id
      )
      BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS counterfactual_observations_no_replace
      BEFORE INSERT ON counterfactual_observations
      WHEN EXISTS (
        SELECT 1 FROM counterfactual_observations WHERE observation_id = NEW.observation_id
      )
      BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
      CREATE TRIGGER IF NOT EXISTS operator_proposals_no_replace
      BEFORE INSERT ON operator_proposals
      WHEN EXISTS (
        SELECT 1 FROM operator_proposals WHERE proposal_id = NEW.proposal_id
      )
      BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
    `);
  }

  appendPrediction(prediction) {
    const validation = validateCounterfactualPrediction(prediction);
    if (!validation.ok) throw new Error(validation.reason);
    const pack = this.#resolvePack(prediction.packRef);
    const operators = new Map(allOperators(pack).map(operator => [operatorKey(operator), operator]));
    const sourceOperator = operators.get(operatorKey(prediction.operatorRef));
    if (!sourceOperator) {
      throw new Error(`counterfactual_operator_not_found:${operatorKey(prediction.operatorRef)}`);
    }
    const axes = new Map(pack.axes.map(axis => [axis.axisId, axis]));
    const seenInterventionAxes = new Set();
    for (const change of prediction.intervention.axisChanges) {
      if (seenInterventionAxes.has(change.axisId)) {
        throw new Error(`counterfactual_intervention_axis_duplicate:${change.axisId}`);
      }
      seenInterventionAxes.add(change.axisId);
      const axis = axes.get(change.axisId);
      if (!axis) throw new Error(`counterfactual_axis_not_found:${change.axisId}`);
      if (!valueMatchesSchema(change.value, axis.valueSchema)) {
        throw new Error(`counterfactual_axis_value_invalid:${change.axisId}`);
      }
      if (!sourceOperator.effects.some(effect => (
        effect.axisId === change.axisId && effect.mode === change.mode
      ))) {
        throw new Error(`counterfactual_effect_not_supported:${change.axisId}:${change.mode}`);
      }
    }
    const lockIds = new Set(pack.locks.map(lock => lock.lockId));
    const unknownLock = prediction.intervention.lockIds.find(lockId => !lockIds.has(lockId));
    if (unknownLock) throw new Error(`counterfactual_lock_not_found:${unknownLock}`);
    const missingClosure = prediction.intervention.minimalClosureOperatorRefs
      .find(ref => !operators.has(operatorKey(ref)));
    if (missingClosure) {
      throw new Error(`counterfactual_closure_operator_not_found:${operatorKey(missingClosure)}`);
    }
    const unknownDelta = prediction.predictedDeltas.find(delta => !axes.has(delta.axisId));
    if (unknownDelta) throw new Error(`counterfactual_axis_not_found:${unknownDelta.axisId}`);

    this.#database.prepare(`
      INSERT INTO counterfactual_predictions (
        prediction_id, pack_id, version, digest, operator_id, operator_version,
        artifact_before_id, artifact_before_sha256, intervention_json,
        predicted_deltas_json, scope_refs_json, rationale_refs_json,
        alternative_rationale_refs_json, evidence_refs_json, evidence_class,
        provenance_kind, provenance_id, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      prediction.predictionId,
      prediction.packRef.packId,
      prediction.packRef.version,
      prediction.packRef.digest,
      prediction.operatorRef.operatorId,
      prediction.operatorRef.version,
      prediction.artifactBefore.artifactId,
      prediction.artifactBefore.sha256,
      canonicalJson(prediction.intervention),
      canonicalJson(prediction.predictedDeltas),
      canonicalJson(prediction.scopeRefs),
      canonicalJson(prediction.rationaleRefs),
      canonicalJson(prediction.alternativeRationaleRefs),
      canonicalJson(prediction.evidenceRefs),
      prediction.evidenceClass,
      prediction.provenance.kind,
      prediction.provenance.id,
      prediction.recordedAt,
    );
    return structuredClone(prediction);
  }

  getPrediction(predictionId) {
    const row = this.#database.prepare(`
      SELECT * FROM counterfactual_predictions WHERE prediction_id = ?
    `).get(predictionId);
    if (!row) throw new Error('counterfactual_prediction_not_found');
    return {
      schema: 'eve-atelier-visual-counterfactual-prediction/v1',
      predictionId: row.prediction_id,
      packRef: { packId: row.pack_id, version: row.version, digest: row.digest },
      operatorRef: { operatorId: row.operator_id, version: row.operator_version },
      artifactBefore: {
        artifactId: row.artifact_before_id,
        sha256: row.artifact_before_sha256,
      },
      intervention: JSON.parse(row.intervention_json),
      predictedDeltas: JSON.parse(row.predicted_deltas_json),
      scopeRefs: JSON.parse(row.scope_refs_json),
      rationaleRefs: JSON.parse(row.rationale_refs_json),
      alternativeRationaleRefs: JSON.parse(row.alternative_rationale_refs_json),
      evidenceRefs: JSON.parse(row.evidence_refs_json),
      evidenceClass: row.evidence_class,
      provenance: { kind: row.provenance_kind, id: row.provenance_id },
      recordedAt: row.recorded_at,
    };
  }

  appendObservation(observation) {
    const validation = validateCounterfactualObservation(observation);
    if (!validation.ok) throw new Error(validation.reason);
    const prediction = this.getPrediction(observation.predictionId);
    if (Date.parse(observation.recordedAt) <= Date.parse(prediction.recordedAt)) {
      throw new Error('counterfactual_observation_not_after_prediction');
    }
    const pack = this.#resolvePack(prediction.packRef);
    const axes = new Set(pack.axes.map(axis => axis.axisId));
    const unknownDelta = [...observation.observedDeltas, ...observation.collateralDeltas]
      .find(delta => !axes.has(delta.axisId));
    if (unknownDelta) throw new Error(`counterfactual_axis_not_found:${unknownDelta.axisId}`);
    const predictedAxes = new Set(prediction.predictedDeltas.map(delta => delta.axisId));
    const unpredicted = observation.observedDeltas
      .find(delta => !predictedAxes.has(delta.axisId));
    if (unpredicted) {
      throw new Error(`counterfactual_observation_unpredicted_axis:${unpredicted.axisId}`);
    }

    this.#database.prepare(`
      INSERT INTO counterfactual_observations (
        observation_id, prediction_id, artifact_after_id, artifact_after_sha256,
        observed_deltas_json, collateral_deltas_json, evaluation_refs_json,
        limitation_refs_json, evidence_refs_json, evidence_class,
        provenance_kind, provenance_id, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      observation.observationId,
      observation.predictionId,
      observation.artifactAfter.artifactId,
      observation.artifactAfter.sha256,
      canonicalJson(observation.observedDeltas),
      canonicalJson(observation.collateralDeltas),
      canonicalJson(observation.evaluationRefs),
      canonicalJson(observation.limitationRefs),
      canonicalJson(observation.evidenceRefs),
      observation.evidenceClass,
      observation.provenance.kind,
      observation.provenance.id,
      observation.recordedAt,
    );
    return structuredClone(observation);
  }

  getObservation(observationId) {
    const row = this.#database.prepare(`
      SELECT * FROM counterfactual_observations WHERE observation_id = ?
    `).get(observationId);
    if (!row) throw new Error('counterfactual_observation_not_found');
    return {
      schema: 'eve-atelier-visual-counterfactual-observation/v1',
      observationId: row.observation_id,
      predictionId: row.prediction_id,
      artifactAfter: { artifactId: row.artifact_after_id, sha256: row.artifact_after_sha256 },
      observedDeltas: JSON.parse(row.observed_deltas_json),
      collateralDeltas: JSON.parse(row.collateral_deltas_json),
      evaluationRefs: JSON.parse(row.evaluation_refs_json),
      limitationRefs: JSON.parse(row.limitation_refs_json),
      evidenceRefs: JSON.parse(row.evidence_refs_json),
      evidenceClass: row.evidence_class,
      provenance: { kind: row.provenance_kind, id: row.provenance_id },
      recordedAt: row.recorded_at,
    };
  }

  listObservations({ predictionId } = {}) {
    const rows = predictionId === undefined
      ? this.#database.prepare('SELECT observation_id FROM counterfactual_observations ORDER BY rowid').all()
      : this.#database.prepare(`
        SELECT observation_id FROM counterfactual_observations
        WHERE prediction_id = ? ORDER BY rowid
      `).all(predictionId);
    return rows.map(row => this.getObservation(row.observation_id));
  }

  compare({ predictionId, observationId } = {}) {
    const prediction = this.getPrediction(predictionId);
    const observation = this.getObservation(observationId);
    if (observation.predictionId !== prediction.predictionId) {
      throw new Error('counterfactual_observation_prediction_mismatch');
    }
    const observed = new Map(observation.observedDeltas.map(delta => [delta.axisId, delta]));
    const summary = { MATCH: 0, PARTIAL: 0, MISMATCH: 0, UNRESOLVED: 0, COLLATERAL: 0 };
    const deltas = prediction.predictedDeltas.map(predicted => {
      const actual = observed.get(predicted.axisId);
      const status = compareDelta(predicted, actual);
      summary[status] += 1;
      const result = { axisId: predicted.axisId, status, predicted: structuredClone(predicted) };
      if (actual) result.observed = structuredClone(actual);
      return result;
    });
    for (const collateral of observation.collateralDeltas) {
      summary.COLLATERAL += 1;
      deltas.push({
        axisId: collateral.axisId,
        status: 'COLLATERAL',
        observed: structuredClone(collateral),
      });
    }
    return {
      schema: 'eve-atelier-visual-counterfactual-comparison/v1',
      predictionId,
      observationId,
      deltas,
      summary,
    };
  }

  appendProposal(proposal) {
    const validation = validateOperatorProposal(proposal);
    if (!validation.ok) throw new Error(validation.reason);
    const pack = this.#resolvePack(proposal.basePackRef);
    const operators = new Set(allOperators(pack).map(operatorKey));
    if (operators.has(operatorKey(proposal.proposedOperatorRef))) {
      throw new Error(`operator_proposal_already_defined:${operatorKey(proposal.proposedOperatorRef)}`);
    }
    const missingComponent = proposal.decomposition.componentOperatorRefs
      .find(ref => !operators.has(operatorKey(ref)));
    if (missingComponent) {
      throw new Error(`operator_proposal_component_not_found:${operatorKey(missingComponent)}`);
    }
    for (const residualRef of proposal.residualRefs) {
      const row = this.#database.prepare(`
        SELECT prediction_id FROM counterfactual_observations WHERE observation_id = ?
      `).get(residualRef);
      if (!row) throw new Error(`operator_proposal_residual_not_found:${residualRef}`);
      const prediction = this.getPrediction(row.prediction_id);
      if (canonicalJson(prediction.packRef) !== canonicalJson(proposal.basePackRef)) {
        throw new Error(`operator_proposal_residual_pack_mismatch:${residualRef}`);
      }
    }

    this.#database.prepare(`
      INSERT INTO operator_proposals (
        proposal_id, base_pack_id, base_version, base_digest,
        proposed_operator_id, proposed_operator_version, decomposition_json,
        scope_refs_json, residual_refs_json, rationale_refs_json, evidence_refs_json,
        counterevidence_refs_json, provenance_kind, provenance_id, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposal.proposalId,
      proposal.basePackRef.packId,
      proposal.basePackRef.version,
      proposal.basePackRef.digest,
      proposal.proposedOperatorRef.operatorId,
      proposal.proposedOperatorRef.version,
      canonicalJson(proposal.decomposition),
      canonicalJson(proposal.scopeRefs),
      canonicalJson(proposal.residualRefs),
      canonicalJson(proposal.rationaleRefs),
      canonicalJson(proposal.evidenceRefs),
      canonicalJson(proposal.counterevidenceRefs),
      proposal.provenance.kind,
      proposal.provenance.id,
      proposal.recordedAt,
    );
    return structuredClone(proposal);
  }

  listProposals({ proposedOperatorId } = {}) {
    const rows = proposedOperatorId === undefined
      ? this.#database.prepare('SELECT * FROM operator_proposals ORDER BY rowid').all()
      : this.#database.prepare(`
        SELECT * FROM operator_proposals WHERE proposed_operator_id = ? ORDER BY rowid
      `).all(proposedOperatorId);
    return rows.map(row => ({
      schema: 'eve-atelier-operator-proposal/v1',
      proposalId: row.proposal_id,
      basePackRef: {
        packId: row.base_pack_id,
        version: row.base_version,
        digest: row.base_digest,
      },
      proposedOperatorRef: {
        operatorId: row.proposed_operator_id,
        version: row.proposed_operator_version,
      },
      decomposition: JSON.parse(row.decomposition_json),
      scopeRefs: JSON.parse(row.scope_refs_json),
      residualRefs: JSON.parse(row.residual_refs_json),
      rationaleRefs: JSON.parse(row.rationale_refs_json),
      evidenceRefs: JSON.parse(row.evidence_refs_json),
      counterevidenceRefs: JSON.parse(row.counterevidence_refs_json),
      provenance: { kind: row.provenance_kind, id: row.provenance_id },
      recordedAt: row.recorded_at,
    }));
  }
}
