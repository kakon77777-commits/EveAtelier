import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../operator-runtime/canonical.js';
import { isCanonicalInstant } from '../operator-runtime/time.js';
import {
  cloneArtValue,
  normalizeArtValue,
  sameArtValue,
  validateAssetRef,
  validateArtActor,
  validateArtAssetBinding,
  validateArtCurrentEvent,
  validateArtDocument,
  validateArtDocumentVersion,
  validateArtEvaluation,
  validateArtFieldBinding,
  validateArtHumanReview,
  validateArtLayer,
  validateArtMask,
  validateArtProject,
  validateArtRegion,
  validateArtSelection,
  validateArtStructureBinding,
  validateOperatorExecutionReceipt,
} from './contracts.js';

function triggers(table, conflictWhen) {
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
    WHEN EXISTS (SELECT 1 FROM ${table} WHERE rowid = NEW.rowid OR (${conflictWhen}))
    BEGIN SELECT RAISE(ABORT, 'append_only_replace_forbidden'); END;
  `;
}

function sealedVersionGuard(table, versionColumn = 'version_id') {
  return `
    CREATE TRIGGER IF NOT EXISTS ${table}_sealed_version_insert_forbidden
    BEFORE INSERT ON ${table}
    WHEN EXISTS (
      SELECT 1 FROM art_version_graph_seals
      WHERE version_id = NEW.${versionColumn}
    )
    BEGIN SELECT RAISE(ABORT, 'sealed_version_insert_forbidden'); END;
  `;
}

function requiredStore(store) {
  if (!store
      || typeof store.getAsset !== 'function'
      || typeof store.verifyAsset !== 'function') {
    throw new TypeError('asset_store_required');
  }
  return store;
}

function copiedComponentId(kind, componentId, versionId) {
  const digest = createHash('sha256')
    .update(`${kind}\u0000${componentId}\u0000${versionId}`)
    .digest('hex');
  return `${kind.toLowerCase()}:versioned:${digest}`;
}

export class ArtDocumentStore {
  #database;
  #assetStore;

  constructor({ path = ':memory:', assetStore }) {
    this.#assetStore = requiredStore(assetStore);
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS art_projects (
        project_id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_documents (
        document_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES art_projects(project_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_execution_receipts (
        execution_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        record_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_versions (
        version_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_kind TEXT NOT NULL,
        execution_id TEXT,
        record_json TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES art_documents(document_id),
        FOREIGN KEY (execution_id) REFERENCES art_execution_receipts(execution_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_layers (
        layer_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_masks (
        mask_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_regions (
        region_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_selections (
        selection_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_structure_bindings (
        structure_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_field_bindings (
        field_binding_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_asset_bindings (
        binding_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_evaluations (
        evaluation_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        verdict TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_human_reviews (
        review_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        disposition TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_current_events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        document_id TEXT NOT NULL,
        from_version_id TEXT,
        to_version_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        evaluation_id TEXT,
        review_id TEXT,
        record_json TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES art_documents(document_id),
        FOREIGN KEY (to_version_id) REFERENCES art_versions(version_id),
        FOREIGN KEY (evaluation_id) REFERENCES art_evaluations(evaluation_id),
        FOREIGN KEY (review_id) REFERENCES art_human_reviews(review_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_projection_events (
        projection_event_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        projection_status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_projection_attempts (
        attempt_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        projection_event_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        provider_resource_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS art_component_lineage (
        lineage_id TEXT PRIMARY KEY,
        component_kind TEXT NOT NULL,
        child_component_id TEXT NOT NULL,
        parent_component_id TEXT NOT NULL,
        from_version_id TEXT NOT NULL,
        to_version_id TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE(component_kind, child_component_id, parent_component_id),
        FOREIGN KEY (from_version_id) REFERENCES art_versions(version_id),
        FOREIGN KEY (to_version_id) REFERENCES art_versions(version_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS art_version_graph_seals (
        version_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        component_digest TEXT NOT NULL,
        component_count INTEGER NOT NULL,
        policy TEXT NOT NULL,
        parent_graph_digest TEXT,
        record_json TEXT NOT NULL,
        FOREIGN KEY (version_id) REFERENCES art_versions(version_id),
        FOREIGN KEY (document_id) REFERENCES art_documents(document_id)
      ) STRICT;

      ${triggers('art_projects', 'project_id = NEW.project_id')}
      ${triggers('art_documents', 'document_id = NEW.document_id')}
      ${triggers('art_execution_receipts', 'execution_id = NEW.execution_id')}
      ${triggers('art_versions', 'version_id = NEW.version_id')}
      ${triggers('art_layers', 'layer_id = NEW.layer_id')}
      ${triggers('art_masks', 'mask_id = NEW.mask_id')}
      ${triggers('art_regions', 'region_id = NEW.region_id')}
      ${triggers('art_selections', 'selection_id = NEW.selection_id')}
      ${triggers('art_structure_bindings', 'structure_id = NEW.structure_id')}
      ${triggers('art_field_bindings', 'field_binding_id = NEW.field_binding_id')}
      ${triggers('art_asset_bindings', 'binding_id = NEW.binding_id')}
      ${triggers('art_evaluations', 'evaluation_id = NEW.evaluation_id')}
      ${triggers('art_human_reviews', 'review_id = NEW.review_id')}
      ${triggers('art_current_events', 'event_id = NEW.event_id OR event_sequence = NEW.event_sequence')}
      ${triggers('art_projection_events', 'projection_event_id = NEW.projection_event_id OR idempotency_key = NEW.idempotency_key')}
      ${triggers('art_projection_attempts', 'attempt_id = NEW.attempt_id OR idempotency_key = NEW.idempotency_key')}
      ${triggers('art_component_lineage', 'lineage_id = NEW.lineage_id OR (component_kind = NEW.component_kind AND child_component_id = NEW.child_component_id AND parent_component_id = NEW.parent_component_id)')}
      ${triggers('art_version_graph_seals', 'version_id = NEW.version_id')}
      ${sealedVersionGuard('art_layers')}
      ${sealedVersionGuard('art_masks')}
      ${sealedVersionGuard('art_regions')}
      ${sealedVersionGuard('art_selections')}
      ${sealedVersionGuard('art_structure_bindings')}
      ${sealedVersionGuard('art_field_bindings')}
      ${sealedVersionGuard('art_asset_bindings')}
      ${sealedVersionGuard('art_component_lineage', 'to_version_id')}
    `);
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
      if (!sameArtValue(retained, record)) throw new Error(conflict);
      return retained;
    }
    this.#database.prepare(`
      INSERT INTO ${table} (${columns.join(', ')}, record_json)
      VALUES (${columns.map(() => '?').join(', ')}, ?)
    `).run(...values, canonicalJson(record));
    return cloneArtValue(record);
  }

  #versionContext(documentId, versionId) {
    const version = this.getVersion(versionId);
    if (version.documentId !== documentId) throw new Error('art_component_document_mismatch');
    return version;
  }

  registerProject(value) {
    value = normalizeArtValue(value, 'art_project_json_value_invalid');
    const validation = validateArtProject(value);
    if (!validation.ok) throw new Error(validation.reason);
    return this.#append({
      table: 'art_projects',
      idColumn: 'project_id',
      id: value.projectId,
      record: value,
      columns: ['project_id'],
      values: [value.projectId],
      conflict: 'art_project_id_conflict',
    });
  }

  getProject(projectId) {
    const row = this.#database.prepare('SELECT record_json FROM art_projects WHERE project_id = ?')
      .get(projectId);
    if (!row) throw new Error('art_project_not_found');
    return JSON.parse(row.record_json);
  }

  registerDocument(value) {
    value = normalizeArtValue(value, 'art_document_json_value_invalid');
    const validation = validateArtDocument(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.getProject(value.projectId);
    return this.#append({
      table: 'art_documents',
      idColumn: 'document_id',
      id: value.documentId,
      record: value,
      columns: ['document_id', 'project_id'],
      values: [value.documentId, value.projectId],
      conflict: 'art_document_id_conflict',
    });
  }

  getDocument(documentId) {
    const row = this.#database.prepare('SELECT record_json FROM art_documents WHERE document_id = ?')
      .get(documentId);
    if (!row) throw new Error('art_document_not_found');
    return JSON.parse(row.record_json);
  }

  #appendExecutionReceipt(receipt, recordedAt) {
    receipt = normalizeArtValue(receipt, 'art_execution_receipt_json_value_invalid');
    const operatorReceipt = receipt?.schema === 'eve-atelier-operator-execution-receipt/v1';
    const workbenchReceipt = receipt?.schema === 'eve-atelier-workbench-execution-receipt/v1';
    if (!receipt
        || (!operatorReceipt && !workbenchReceipt)
        || typeof receipt.executionId !== 'string'
        || receipt.executionId.length === 0
        || typeof receipt.operationId !== 'string'
        || receipt.operationId.length === 0
        || !['completed', 'failed'].includes(receipt.status)
        || !isCanonicalInstant(recordedAt)) {
      throw new Error('art_execution_receipt_invalid');
    }
    if (operatorReceipt && !validateOperatorExecutionReceipt(receipt).ok) {
      throw new Error('art_operator_execution_receipt_invalid');
    }
    if (workbenchReceipt) {
      const fields = [
        'schema', 'executionId', 'operationId', 'providerReceipt', 'inputAssets',
        'outputAsset', 'status', 'recordedAt',
      ];
      if (Object.keys(receipt).length !== fields.length
          || Object.keys(receipt).some(key => !fields.includes(key))
          || !validateOperatorExecutionReceipt(receipt.providerReceipt).ok
          || receipt.providerReceipt.executionId !== receipt.executionId
          || receipt.providerReceipt.operationId !== receipt.operationId
          || receipt.providerReceipt.status !== receipt.status
          || !Array.isArray(receipt.inputAssets)
          || receipt.inputAssets.length === 0
          || receipt.inputAssets.some(item => !validateAssetRef(item).ok)
          || !validateAssetRef(receipt.outputAsset).ok
          || receipt.recordedAt !== recordedAt) {
        throw new Error('art_workbench_execution_receipt_invalid');
      }
      for (const asset of [...receipt.inputAssets, receipt.outputAsset]) {
        this.#assetStore.verifyAsset(asset);
      }
    }
    return this.#append({
      table: 'art_execution_receipts',
      idColumn: 'execution_id',
      id: receipt.executionId,
      record: receipt,
      columns: ['execution_id', 'operation_id', 'status', 'recorded_at'],
      values: [receipt.executionId, receipt.operationId, receipt.status, recordedAt],
      conflict: 'art_execution_receipt_id_conflict',
    });
  }

  appendAssetOnlyExecutionReceipt(receipt, recordedAt) {
    if (receipt?.schema !== 'eve-atelier-workbench-execution-receipt/v1') {
      throw new Error('art_asset_only_workbench_receipt_required');
    }
    return this.#appendExecutionReceipt(receipt, recordedAt);
  }

  getExecutionReceipt(executionId) {
    const row = this.#database.prepare(`
      SELECT record_json FROM art_execution_receipts WHERE execution_id = ?
    `).get(executionId);
    if (!row) throw new Error('art_execution_receipt_not_found');
    return JSON.parse(row.record_json);
  }

  #appendVersion(value) {
    value = normalizeArtValue(value, 'art_document_version_json_value_invalid');
    const validation = validateArtDocumentVersion(value);
    if (!validation.ok) throw new Error(validation.reason);
    const document = this.getDocument(value.documentId);
    this.#assetStore.verifyAsset(value.primaryAsset);
    for (const parentId of value.parentVersionIds) this.#versionContext(value.documentId, parentId);
    if (value.createdByExecutionId !== null) this.getExecutionReceipt(value.createdByExecutionId);
    if (value.kind === 'SOURCE') {
      const count = this.#database.prepare(`
        SELECT COUNT(*) AS count FROM art_versions WHERE document_id = ?
      `).get(value.documentId).count;
      if (Number(count) !== 0) throw new Error('art_source_version_must_be_first');
      if (!sameArtValue(value.canvasExtent, document.canvasExtent)
          || value.colorSpace !== document.colorSpace) {
        throw new Error('art_source_version_document_metadata_mismatch');
      }
    }
    return this.#append({
      table: 'art_versions',
      idColumn: 'version_id',
      id: value.versionId,
      record: value,
      columns: ['version_id', 'document_id', 'version_kind', 'execution_id'],
      values: [value.versionId, value.documentId, value.kind, value.createdByExecutionId],
      conflict: 'art_document_version_id_conflict',
    });
  }

  getVersion(versionId) {
    const row = this.#database.prepare('SELECT record_json FROM art_versions WHERE version_id = ?')
      .get(versionId);
    if (!row) throw new Error('art_document_version_not_found');
    return JSON.parse(row.record_json);
  }

  listVersions(documentId) {
    return this.#database.prepare(`
      SELECT record_json FROM art_versions WHERE document_id = ? ORDER BY rowid
    `).all(documentId).map(row => JSON.parse(row.record_json));
  }

  appendLayer(value) {
    value = normalizeArtValue(value, 'art_layer_json_value_invalid');
    const validation = validateArtLayer(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#versionContext(value.documentId, value.versionId);
    this.#assertVersionGraphUnsealed(value.versionId);
    if (value.assetRef !== null) this.#assetStore.verifyAsset(value.assetRef);
    for (const maskId of value.maskIds) {
      const mask = this.getMask(maskId);
      if (mask.documentId !== value.documentId || mask.versionId !== value.versionId) {
        throw new Error(`art_layer_mask_scope_mismatch:${maskId}`);
      }
    }
    if (value.parentLayerId !== null) {
      const parent = this.getLayer(value.parentLayerId);
      if (parent.documentId !== value.documentId
          || parent.versionId !== value.versionId
          || parent.layerType !== 'GROUP') {
        throw new Error('art_layer_parent_group_invalid');
      }
    }
    return this.#append({
      table: 'art_layers', idColumn: 'layer_id', id: value.layerId, record: value,
      columns: ['layer_id', 'document_id', 'version_id'],
      values: [value.layerId, value.documentId, value.versionId],
      conflict: 'art_layer_id_conflict',
    });
  }

  getLayer(id) {
    return this.#getComponent('art_layers', 'layer_id', id, 'art_layer_not_found');
  }

  listLayers(documentId, versionId) {
    return this.#listComponents('art_layers', documentId, versionId);
  }

  appendMask(value) {
    value = normalizeArtValue(value, 'art_mask_json_value_invalid');
    const validation = validateArtMask(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#versionContext(value.documentId, value.versionId);
    this.#assertVersionGraphUnsealed(value.versionId);
    this.#assetStore.verifyAsset(value.assetRef);
    return this.#append({
      table: 'art_masks', idColumn: 'mask_id', id: value.maskId, record: value,
      columns: ['mask_id', 'document_id', 'version_id'],
      values: [value.maskId, value.documentId, value.versionId],
      conflict: 'art_mask_id_conflict',
    });
  }

  getMask(id) {
    return this.#getComponent('art_masks', 'mask_id', id, 'art_mask_not_found');
  }

  listMasks(documentId, versionId) {
    return this.#listComponents('art_masks', documentId, versionId);
  }

  appendRegion(value) {
    value = normalizeArtValue(value, 'art_region_json_value_invalid');
    const validation = validateArtRegion(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#versionContext(value.documentId, value.versionId);
    this.#assertVersionGraphUnsealed(value.versionId);
    if (value.representation.kind === 'MASK') {
      const mask = this.getMask(value.representation.refId);
      if (mask.documentId !== value.documentId || mask.versionId !== value.versionId) {
        throw new Error('art_region_mask_scope_mismatch');
      }
    }
    return this.#append({
      table: 'art_regions', idColumn: 'region_id', id: value.regionId, record: value,
      columns: ['region_id', 'document_id', 'version_id'],
      values: [value.regionId, value.documentId, value.versionId],
      conflict: 'art_region_id_conflict',
    });
  }

  getRegion(id) {
    return this.#getComponent('art_regions', 'region_id', id, 'art_region_not_found');
  }

  listRegions(documentId, versionId) {
    return this.#listComponents('art_regions', documentId, versionId);
  }

  appendSelection(value) {
    value = normalizeArtValue(value, 'art_selection_json_value_invalid');
    const validation = validateArtSelection(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#versionContext(value.documentId, value.versionId);
    this.#assertVersionGraphUnsealed(value.versionId);
    if (value.representation.assetRef !== null) {
      this.#assetStore.verifyAsset(value.representation.assetRef);
    }
    return this.#append({
      table: 'art_selections', idColumn: 'selection_id', id: value.selectionId, record: value,
      columns: ['selection_id', 'document_id', 'version_id'],
      values: [value.selectionId, value.documentId, value.versionId],
      conflict: 'art_selection_id_conflict',
    });
  }

  getSelection(id) {
    return this.#getComponent('art_selections', 'selection_id', id, 'art_selection_not_found');
  }

  listSelections(documentId, versionId) {
    return this.#listComponents('art_selections', documentId, versionId);
  }

  appendStructureBinding(value) {
    value = normalizeArtValue(value, 'art_structure_binding_json_value_invalid');
    const validation = validateArtStructureBinding(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#versionContext(value.documentId, value.versionId);
    this.#assertVersionGraphUnsealed(value.versionId);
    return this.#append({
      table: 'art_structure_bindings', idColumn: 'structure_id', id: value.structureId,
      record: value, columns: ['structure_id', 'document_id', 'version_id'],
      values: [value.structureId, value.documentId, value.versionId],
      conflict: 'art_structure_binding_id_conflict',
    });
  }

  getStructureBinding(id) {
    return this.#getComponent(
      'art_structure_bindings', 'structure_id', id, 'art_structure_binding_not_found',
    );
  }

  listStructureBindings(documentId, versionId) {
    return this.#listComponents('art_structure_bindings', documentId, versionId);
  }

  appendFieldBinding(value) {
    value = normalizeArtValue(value, 'art_field_binding_json_value_invalid');
    const validation = validateArtFieldBinding(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#versionContext(value.documentId, value.versionId);
    this.#assertVersionGraphUnsealed(value.versionId);
    this.#assetStore.verifyAsset(value.derivedFromAsset);
    return this.#append({
      table: 'art_field_bindings', idColumn: 'field_binding_id', id: value.fieldBindingId,
      record: value, columns: ['field_binding_id', 'document_id', 'version_id'],
      values: [value.fieldBindingId, value.documentId, value.versionId],
      conflict: 'art_field_binding_id_conflict',
    });
  }

  getFieldBinding(id) {
    return this.#getComponent(
      'art_field_bindings', 'field_binding_id', id, 'art_field_binding_not_found',
    );
  }

  listFieldBindings(documentId, versionId) {
    return this.#listComponents('art_field_bindings', documentId, versionId);
  }

  #appendAssetBinding(value) {
    value = normalizeArtValue(value, 'art_asset_binding_json_value_invalid');
    const validation = validateArtAssetBinding(value);
    if (!validation.ok) throw new Error(validation.reason);
    this.#versionContext(value.documentId, value.versionId);
    this.#assertVersionGraphUnsealed(value.versionId);
    this.#assetStore.verifyAsset(value.assetRef);
    const target = value.target.kind === 'DOCUMENT_VERSION'
      ? this.getVersion(value.target.id)
      : value.target.kind === 'LAYER'
        ? this.getLayer(value.target.id)
        : value.target.kind === 'MASK'
          ? this.getMask(value.target.id)
          : value.target.kind === 'SELECTION'
            ? this.getSelection(value.target.id)
            : this.getFieldBinding(value.target.id);
    if ((target.versionId ?? target.fieldBindingId) === undefined
        || target.documentId !== value.documentId
        || target.versionId !== value.versionId) {
      throw new Error('art_asset_binding_target_scope_mismatch');
    }
    return this.#append({
      table: 'art_asset_bindings', idColumn: 'binding_id', id: value.bindingId, record: value,
      columns: ['binding_id', 'document_id', 'version_id', 'target_kind', 'target_id'],
      values: [value.bindingId, value.documentId, value.versionId, value.target.kind, value.target.id],
      conflict: 'art_asset_binding_id_conflict',
    });
  }

  getAssetBinding(id) {
    return this.#getComponent('art_asset_bindings', 'binding_id', id, 'art_asset_binding_not_found');
  }

  listAssetBindings(documentId, versionId) {
    return this.#listComponents('art_asset_bindings', documentId, versionId);
  }

  #assertVersionGraphUnsealed(versionId) {
    const retained = this.#database.prepare(`
      SELECT 1 AS sealed FROM art_version_graph_seals WHERE version_id = ?
    `).get(versionId);
    if (retained) throw new Error('art_version_graph_sealed');
  }

  #versionGraphPayload(documentId, versionId) {
    const sortBy = (items, key) => [...items]
      .sort((left, right) => left[key].localeCompare(right[key]));
    return {
      assetBindings: sortBy(this.listAssetBindings(documentId, versionId), 'bindingId'),
      layers: sortBy(this.listLayers(documentId, versionId), 'layerId'),
      masks: sortBy(this.listMasks(documentId, versionId), 'maskId'),
      selections: sortBy(this.listSelections(documentId, versionId), 'selectionId'),
      regions: sortBy(this.listRegions(documentId, versionId), 'regionId'),
      structureBindings: sortBy(
        this.listStructureBindings(documentId, versionId),
        'structureId',
      ),
      fieldBindings: sortBy(this.listFieldBindings(documentId, versionId), 'fieldBindingId'),
    };
  }

  #sealVersionGraph({
    documentId,
    versionId,
    policy,
    parentGraphDigest = null,
    sealedAt,
  }) {
    const version = this.#versionContext(documentId, versionId);
    this.#assertVersionGraphUnsealed(versionId);
    if (!['SOURCE_GRAPH', 'COPY_FORWARD', 'INVALIDATE_SPATIAL'].includes(policy)
        || (parentGraphDigest !== null
          && !/^[a-f0-9]{64}$/.test(parentGraphDigest))
        || !isCanonicalInstant(sealedAt)) {
      throw new Error('art_version_graph_seal_invalid');
    }
    const primaryBindings = this.listAssetBindings(documentId, versionId).filter(binding => (
      binding.assetRole === 'PRIMARY'
      && binding.target.kind === 'DOCUMENT_VERSION'
      && binding.target.id === versionId
    ));
    if (primaryBindings.length !== 1
        || !sameArtValue(primaryBindings[0].assetRef, version.primaryAsset)) {
      throw new Error('art_version_primary_binding_invalid');
    }
    const payload = this.#versionGraphPayload(documentId, versionId);
    const componentCount = Object.values(payload)
      .reduce((total, items) => total + items.length, 0);
    const componentDigest = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    const record = {
      schema: 'eve-atelier-art-version-graph-seal/v1',
      versionId,
      documentId,
      componentDigest,
      componentCount,
      policy,
      parentGraphDigest,
      sealedAt,
    };
    return this.#append({
      table: 'art_version_graph_seals',
      idColumn: 'version_id',
      id: versionId,
      record,
      columns: [
        'version_id', 'document_id', 'component_digest', 'component_count',
        'policy', 'parent_graph_digest',
      ],
      values: [
        versionId, documentId, componentDigest, componentCount, policy, parentGraphDigest,
      ],
      conflict: 'art_version_graph_seal_conflict',
    });
  }

  getVersionGraphSeal(versionId, { allowMissing = false } = {}) {
    const row = this.#database.prepare(`
      SELECT record_json FROM art_version_graph_seals WHERE version_id = ?
    `).get(versionId);
    if (!row) {
      if (allowMissing) return null;
      throw new Error('art_version_graph_unsealed');
    }
    const retained = JSON.parse(row.record_json);
    const payload = this.#versionGraphPayload(retained.documentId, versionId);
    const componentCount = Object.values(payload)
      .reduce((total, items) => total + items.length, 0);
    const componentDigest = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    if (componentCount !== retained.componentCount || componentDigest !== retained.componentDigest) {
      throw new Error('art_version_graph_seal_mismatch');
    }
    return retained;
  }

  recordEvaluation(value) {
    value = normalizeArtValue(value, 'art_evaluation_json_value_invalid');
    const validation = validateArtEvaluation(value);
    if (!validation.ok) throw new Error(validation.reason);
    const version = this.#versionContext(value.documentId, value.versionId);
    if (Date.parse(value.evaluatedAt) < Date.parse(version.createdAt)) {
      throw new Error('art_evaluation_before_version');
    }
    return this.#append({
      table: 'art_evaluations', idColumn: 'evaluation_id', id: value.evaluationId,
      record: value, columns: ['evaluation_id', 'document_id', 'version_id', 'verdict'],
      values: [value.evaluationId, value.documentId, value.versionId, value.verdict],
      conflict: 'art_evaluation_id_conflict',
    });
  }

  getEvaluation(id) {
    return this.#getComponent('art_evaluations', 'evaluation_id', id, 'art_evaluation_not_found');
  }

  recordHumanReview(value) {
    value = normalizeArtValue(value, 'art_human_review_json_value_invalid');
    const validation = validateArtHumanReview(value);
    if (!validation.ok) throw new Error(validation.reason);
    const version = this.#versionContext(value.documentId, value.versionId);
    if (Date.parse(value.reviewedAt) < Date.parse(version.createdAt)) {
      throw new Error('art_human_review_before_version');
    }
    return this.#append({
      table: 'art_human_reviews', idColumn: 'review_id', id: value.reviewId,
      record: value, columns: ['review_id', 'document_id', 'version_id', 'disposition'],
      values: [value.reviewId, value.documentId, value.versionId, value.disposition],
      conflict: 'art_human_review_id_conflict',
    });
  }

  getHumanReview(id) {
    return this.#getComponent('art_human_reviews', 'review_id', id, 'art_human_review_not_found');
  }

  #getComponent(table, idColumn, id, missing) {
    const row = this.#database.prepare(`SELECT record_json FROM ${table} WHERE ${idColumn} = ?`)
      .get(id);
    if (!row) throw new Error(missing);
    return JSON.parse(row.record_json);
  }

  #listComponents(table, documentId, versionId) {
    this.#versionContext(documentId, versionId);
    return this.#database.prepare(`
      SELECT record_json FROM ${table}
      WHERE document_id = ? AND version_id = ? ORDER BY rowid
    `).all(documentId, versionId).map(row => JSON.parse(row.record_json));
  }

  recordProjectionEvent(value) {
    value = normalizeArtValue(value, 'art_projection_event_json_value_invalid');
    const fields = [
      'schema', 'projectionEventId', 'documentId', 'versionId', 'status',
      'idempotencyKey', 'providerResourceId', 'evidenceRefs', 'recordedAt',
    ];
    if (!value
        || Object.keys(value).length !== fields.length
        || Object.keys(value).some(key => !fields.includes(key))
        || value.schema !== 'eve-atelier-art-projection-event/v1'
        || typeof value.projectionEventId !== 'string'
        || value.projectionEventId.length === 0
        || typeof value.documentId !== 'string'
        || typeof value.versionId !== 'string'
        || !['VERIFIED', 'FAILED', 'UNCERTAIN'].includes(value.status)
        || typeof value.idempotencyKey !== 'string'
        || value.idempotencyKey.length === 0
        || typeof value.providerResourceId !== 'string'
        || value.providerResourceId.length === 0
        || !Array.isArray(value.evidenceRefs)
        || value.evidenceRefs.length === 0
        || value.evidenceRefs.some(item => typeof item !== 'string' || item.length === 0)
        || !isCanonicalInstant(value.recordedAt)) {
      throw new Error('art_projection_event_invalid');
    }
    this.#versionContext(value.documentId, value.versionId);
    const attempt = this.getProjectionAttemptByIdempotencyKey(value.idempotencyKey);
    if (attempt.documentId !== value.documentId
        || attempt.versionId !== value.versionId
        || attempt.projectionEventId !== value.projectionEventId
        || attempt.providerResourceId !== value.providerResourceId) {
      throw new Error('art_projection_event_attempt_mismatch');
    }
    return this.#append({
      table: 'art_projection_events',
      idColumn: 'projection_event_id',
      id: value.projectionEventId,
      record: value,
      columns: [
        'projection_event_id', 'document_id', 'version_id', 'projection_status',
        'idempotency_key',
      ],
      values: [
        value.projectionEventId, value.documentId, value.versionId, value.status,
        value.idempotencyKey,
      ],
      conflict: 'art_projection_event_id_conflict',
    });
  }

  prepareProjectionAttempt(value) {
    value = normalizeArtValue(value, 'art_projection_attempt_json_value_invalid');
    const fields = [
      'schema', 'attemptId', 'projectionEventId', 'documentId', 'versionId', 'mode',
      'idempotencyKey', 'providerResourceId', 'preparedAt',
    ];
    if (!value
        || Object.keys(value).length !== fields.length
        || Object.keys(value).some(key => !fields.includes(key))
        || value.schema !== 'eve-atelier-art-projection-attempt/v1'
        || typeof value.attemptId !== 'string'
        || value.attemptId.length === 0
        || typeof value.projectionEventId !== 'string'
        || value.projectionEventId.length === 0
        || typeof value.documentId !== 'string'
        || typeof value.versionId !== 'string'
        || !['CREATE', 'PATCH'].includes(value.mode)
        || typeof value.idempotencyKey !== 'string'
        || value.idempotencyKey.length === 0
        || typeof value.providerResourceId !== 'string'
        || value.providerResourceId.length === 0
        || !isCanonicalInstant(value.preparedAt)) {
      throw new Error('art_projection_attempt_invalid');
    }
    this.#versionContext(value.documentId, value.versionId);
    return this.#append({
      table: 'art_projection_attempts',
      idColumn: 'attempt_id',
      id: value.attemptId,
      record: value,
      columns: [
        'attempt_id', 'projection_event_id', 'document_id', 'version_id', 'mode',
        'idempotency_key', 'provider_resource_id',
      ],
      values: [
        value.attemptId, value.projectionEventId, value.documentId, value.versionId,
        value.mode, value.idempotencyKey, value.providerResourceId,
      ],
      conflict: 'art_projection_attempt_id_conflict',
    });
  }

  getProjectionAttemptByIdempotencyKey(idempotencyKey, { allowMissing = false } = {}) {
    const row = this.#database.prepare(`
      SELECT record_json FROM art_projection_attempts WHERE idempotency_key = ?
    `).get(idempotencyKey);
    if (!row) {
      if (allowMissing) return null;
      throw new Error('art_projection_attempt_not_found');
    }
    return JSON.parse(row.record_json);
  }

  listProjectionEvents(documentId, versionId) {
    return this.#listComponents('art_projection_events', documentId, versionId);
  }

  getProjectionEventByIdempotencyKey(idempotencyKey, { allowMissing = false } = {}) {
    const row = this.#database.prepare(`
      SELECT record_json FROM art_projection_events WHERE idempotency_key = ?
    `).get(idempotencyKey);
    if (!row) {
      if (allowMissing) return null;
      throw new Error('art_projection_event_not_found');
    }
    return JSON.parse(row.record_json);
  }

  #appendCurrentEvent(value) {
    value = normalizeArtValue(value, 'art_current_event_json_value_invalid');
    const validation = validateArtCurrentEvent(value);
    if (!validation.ok) throw new Error(validation.reason);
    const document = this.getDocument(value.documentId);
    const toVersion = this.#versionContext(value.documentId, value.toVersionId);
    const toGraphSeal = this.getVersionGraphSeal(value.toVersionId);
    if (toGraphSeal.documentId !== value.documentId) {
      throw new Error('art_current_version_graph_scope_mismatch');
    }
    if (toVersion.primaryAssetStatus !== 'CURRENT_RENDER') {
      throw new Error('art_current_render_required');
    }
    const current = this.getCurrentEvent(value.documentId, { allowMissing: true });
    const currentVersionId = current?.event.toVersionId ?? null;
    if (value.fromVersionId !== currentVersionId) {
      throw new Error(`art_current_event_stale:${currentVersionId ?? 'NONE'}`);
    }
    if (Date.parse(value.occurredAt) < Date.parse(toVersion.createdAt)
        || (current && Date.parse(value.occurredAt) <= Date.parse(current.event.occurredAt))) {
      throw new Error('art_current_event_time_invalid');
    }
    if (value.reason === 'INITIAL') {
      if (current !== null || toVersion.kind !== 'SOURCE') throw new Error('art_initial_event_invalid');
    } else if (value.reason === 'PROMOTION') {
      if (toVersion.kind !== 'CANDIDATE' || value.toVersionId === currentVersionId) {
        throw new Error('art_promotion_candidate_required');
      }
      const evaluation = this.getEvaluation(value.evaluationId);
      if (evaluation.documentId !== value.documentId
          || evaluation.versionId !== value.toVersionId
          || !['ACCEPT', 'ACCEPT_WITH_WARNINGS'].includes(evaluation.verdict)) {
        throw new Error('art_promotion_evaluation_not_accepted');
      }
      if (Date.parse(value.occurredAt) < Date.parse(evaluation.evaluatedAt)) {
        throw new Error('art_promotion_before_evaluation');
      }
      if (document.promotionPolicy === 'automatic_deterministic'
          && !['DETERMINISTIC', 'HYBRID'].includes(evaluation.evaluator.kind)) {
        throw new Error('art_automatic_promotion_deterministic_evaluator_required');
      }
      if (document.promotionPolicy === 'human_required') {
        if (value.reviewId === null) throw new Error('art_promotion_human_review_required');
        const review = this.getHumanReview(value.reviewId);
        if (review.documentId !== value.documentId
            || review.versionId !== value.toVersionId
            || !['APPROVE', 'ACCEPT_WITH_WARNINGS'].includes(review.disposition)) {
          throw new Error('art_promotion_human_review_not_approved');
        }
        if (Date.parse(value.occurredAt) < Date.parse(review.reviewedAt)) {
          throw new Error('art_promotion_before_review');
        }
      }
    } else {
      if (value.actor.kind === 'AI') throw new Error('art_restore_ai_actor_forbidden');
      if (value.toVersionId === currentVersionId) throw new Error('art_restore_noop_forbidden');
      if (value.evaluationId !== null || value.reviewId !== null) {
        throw new Error('art_restore_evaluation_review_forbidden');
      }
    }
    return this.#append({
      table: 'art_current_events', idColumn: 'event_id', id: value.eventId,
      record: value,
      columns: [
        'event_id', 'document_id', 'from_version_id', 'to_version_id', 'reason',
        'evaluation_id', 'review_id',
      ],
      values: [
        value.eventId, value.documentId, value.fromVersionId, value.toVersionId,
        value.reason, value.evaluationId, value.reviewId,
      ],
      conflict: 'art_current_event_id_conflict',
    });
  }

  getCurrentEvent(documentId, { allowMissing = false } = {}) {
    const row = this.#database.prepare(`
      SELECT event_sequence, record_json FROM art_current_events
      WHERE document_id = ? ORDER BY event_sequence DESC LIMIT 1
    `).get(documentId);
    if (!row) {
      if (allowMissing) return null;
      throw new Error('art_current_event_not_found');
    }
    return { sequence: Number(row.event_sequence), event: JSON.parse(row.record_json) };
  }

  getDocumentSnapshot(documentId) {
    const document = this.getDocument(documentId);
    const current = this.getCurrentEvent(documentId);
    const version = this.getVersion(current.event.toVersionId);
    const componentGraph = this.getVersionGraphSeal(version.versionId);
    return {
      schema: 'eve-atelier-art-document-snapshot/v1',
      document,
      currentVersion: version,
      componentGraph,
      documentRevision: current.sequence,
      currentEvent: current.event,
    };
  }

  createDocumentWithSource({
    document,
    version,
    assetBinding,
    currentEvent,
    components = {},
  }) {
    return this.#transaction(() => {
      if (version.kind !== 'SOURCE'
          || assetBinding.documentId !== version.documentId
          || assetBinding.versionId !== version.versionId
          || assetBinding.target.kind !== 'DOCUMENT_VERSION'
          || assetBinding.target.id !== version.versionId
          || assetBinding.assetRole !== 'PRIMARY'
          || !sameArtValue(assetBinding.assetRef, version.primaryAsset)) {
        throw new Error('art_source_primary_binding_mismatch');
      }
      const allowedComponentKeys = [
        'masks', 'selections', 'layers', 'regions', 'structureBindings',
        'fieldBindings', 'assetBindings',
      ];
      if (!components
          || typeof components !== 'object'
          || Array.isArray(components)
          || Object.keys(components).some(key => !allowedComponentKeys.includes(key))
          || Object.values(components).some(items => !Array.isArray(items))) {
        throw new Error('art_source_components_invalid');
      }
      const createdDocument = this.registerDocument(document);
      const createdVersion = this.#appendVersion(version);
      const createdBinding = this.#appendAssetBinding(assetBinding);
      for (const mask of components.masks ?? []) this.appendMask(mask);
      for (const selection of components.selections ?? []) this.appendSelection(selection);
      for (const layer of components.layers ?? []) this.appendLayer(layer);
      for (const region of components.regions ?? []) this.appendRegion(region);
      for (const structure of components.structureBindings ?? []) {
        this.appendStructureBinding(structure);
      }
      for (const field of components.fieldBindings ?? []) this.appendFieldBinding(field);
      for (const binding of components.assetBindings ?? []) this.#appendAssetBinding(binding);
      const graphSeal = this.#sealVersionGraph({
        documentId: version.documentId,
        versionId: version.versionId,
        policy: 'SOURCE_GRAPH',
        sealedAt: version.createdAt,
      });
      const createdEvent = this.#appendCurrentEvent(currentEvent);
      return {
        document: createdDocument,
        version: createdVersion,
        assetBinding: createdBinding,
        graphSeal,
        currentEvent: createdEvent,
      };
    });
  }

  #appendComponentLineage({ kind, childId, parentId, fromVersionId, toVersionId }) {
    const record = {
      schema: 'eve-atelier-art-component-lineage/v1',
      lineageId: `component-lineage:${createHash('sha256')
        .update(`${kind}\u0000${childId}\u0000${parentId}`)
        .digest('hex')}`,
      componentKind: kind,
      childComponentId: childId,
      parentComponentId: parentId,
      fromVersionId,
      toVersionId,
    };
    return this.#append({
      table: 'art_component_lineage',
      idColumn: 'lineage_id',
      id: record.lineageId,
      record,
      columns: [
        'lineage_id', 'component_kind', 'child_component_id', 'parent_component_id',
        'from_version_id', 'to_version_id',
      ],
      values: [
        record.lineageId, kind, childId, parentId, fromVersionId, toVersionId,
      ],
      conflict: 'art_component_lineage_id_conflict',
    });
  }

  #copyForwardComponents({
    fromVersionId,
    toVersionId,
    replacement,
    createdAt,
    policy,
  }) {
    const fromVersion = this.getVersion(fromVersionId);
    const documentId = fromVersion.documentId;
    const maps = Object.fromEntries([
      'MASK', 'SELECTION', 'LAYER', 'REGION', 'STRUCTURE', 'FIELD',
    ].map(kind => [kind, new Map()]));
    if (policy === 'INVALIDATE_SPATIAL') {
      return Object.fromEntries(Object.entries(maps).map(([kind, map]) => [
        kind,
        Object.fromEntries(map),
      ]));
    }
    if (policy !== 'COPY_FORWARD') throw new Error('art_component_copy_policy_invalid');
    const replacementFor = (kind, id, fallback) => (
      replacement?.kind === kind && replacement.id === id
        ? replacement.assetRef
        : fallback
    );
    const remember = (kind, parentId) => {
      const childId = copiedComponentId(kind, parentId, toVersionId);
      maps[kind].set(parentId, childId);
      return childId;
    };
    for (const mask of this.listMasks(documentId, fromVersionId)) remember('MASK', mask.maskId);
    for (const selection of this.listSelections(documentId, fromVersionId)) {
      remember('SELECTION', selection.selectionId);
    }
    for (const layer of this.listLayers(documentId, fromVersionId)) remember('LAYER', layer.layerId);
    for (const region of this.listRegions(documentId, fromVersionId)) remember('REGION', region.regionId);
    for (const structure of this.listStructureBindings(documentId, fromVersionId)) {
      remember('STRUCTURE', structure.structureId);
    }
    for (const field of this.listFieldBindings(documentId, fromVersionId)) {
      remember('FIELD', field.fieldBindingId);
    }

    for (const mask of this.listMasks(documentId, fromVersionId)) {
      const childId = maps.MASK.get(mask.maskId);
      this.appendMask({
        ...mask,
        maskId: childId,
        versionId: toVersionId,
        assetRef: replacementFor('MASK', mask.maskId, mask.assetRef),
        createdAt,
      });
      this.#appendComponentLineage({
        kind: 'MASK', childId, parentId: mask.maskId, fromVersionId, toVersionId,
      });
    }
    for (const selection of this.listSelections(documentId, fromVersionId)) {
      const childId = maps.SELECTION.get(selection.selectionId);
      const assetRef = selection.representation.assetRef === null
        ? null
        : replacementFor('SELECTION', selection.selectionId, selection.representation.assetRef);
      this.appendSelection({
        ...selection,
        selectionId: childId,
        versionId: toVersionId,
        representation: { ...selection.representation, assetRef },
        createdAt,
      });
      this.#appendComponentLineage({
        kind: 'SELECTION', childId, parentId: selection.selectionId, fromVersionId, toVersionId,
      });
    }
    const pendingLayers = this.listLayers(documentId, fromVersionId).map(layer => ({ ...layer }));
    const insertedLayers = new Set();
    while (pendingLayers.length > 0) {
      const before = pendingLayers.length;
      for (let index = pendingLayers.length - 1; index >= 0; index -= 1) {
        const layer = pendingLayers[index];
        if (layer.parentLayerId !== null && !insertedLayers.has(layer.parentLayerId)) continue;
        const childId = maps.LAYER.get(layer.layerId);
        this.appendLayer({
          ...layer,
          layerId: childId,
          versionId: toVersionId,
          parentLayerId: layer.parentLayerId === null
            ? null
            : maps.LAYER.get(layer.parentLayerId),
          assetRef: layer.assetRef === null
            ? null
            : replacementFor('LAYER', layer.layerId, layer.assetRef),
          maskIds: layer.maskIds.map(maskId => maps.MASK.get(maskId)),
          createdAt,
        });
        this.#appendComponentLineage({
          kind: 'LAYER', childId, parentId: layer.layerId, fromVersionId, toVersionId,
        });
        insertedLayers.add(layer.layerId);
        pendingLayers.splice(index, 1);
      }
      if (pendingLayers.length === before) throw new Error('art_layer_group_cycle');
    }
    for (const region of this.listRegions(documentId, fromVersionId)) {
      const childId = maps.REGION.get(region.regionId);
      const representation = region.representation.kind === 'MASK'
        ? { ...region.representation, refId: maps.MASK.get(region.representation.refId) }
        : { ...region.representation };
      this.appendRegion({
        ...region,
        regionId: childId,
        versionId: toVersionId,
        representation,
        createdAt,
      });
      this.#appendComponentLineage({
        kind: 'REGION', childId, parentId: region.regionId, fromVersionId, toVersionId,
      });
    }
    for (const structure of this.listStructureBindings(documentId, fromVersionId)) {
      const childId = maps.STRUCTURE.get(structure.structureId);
      this.appendStructureBinding({
        ...structure,
        structureId: childId,
        versionId: toVersionId,
        createdAt,
      });
      this.#appendComponentLineage({
        kind: 'STRUCTURE', childId, parentId: structure.structureId, fromVersionId, toVersionId,
      });
    }
    for (const field of this.listFieldBindings(documentId, fromVersionId)) {
      const childId = maps.FIELD.get(field.fieldBindingId);
      this.appendFieldBinding({
        ...field,
        fieldBindingId: childId,
        versionId: toVersionId,
        createdAt,
      });
      this.#appendComponentLineage({
        kind: 'FIELD', childId, parentId: field.fieldBindingId, fromVersionId, toVersionId,
      });
    }
    for (const binding of this.listAssetBindings(documentId, fromVersionId)) {
      if (binding.target.kind === 'DOCUMENT_VERSION') continue;
      const targetMap = maps[binding.target.kind];
      const targetId = targetMap?.get(binding.target.id);
      if (!targetId) throw new Error('art_asset_binding_copy_target_missing');
      let copiedAsset = binding.assetRef;
      if (binding.target.kind === 'LAYER') {
        copiedAsset = this.getLayer(targetId).assetRef;
      } else if (binding.target.kind === 'MASK') {
        copiedAsset = this.getMask(targetId).assetRef;
      } else if (binding.target.kind === 'SELECTION') {
        copiedAsset = this.getSelection(targetId).representation.assetRef ?? binding.assetRef;
      }
      this.#appendAssetBinding({
        ...binding,
        bindingId: copiedComponentId('BINDING', binding.bindingId, toVersionId),
        versionId: toVersionId,
        assetRef: copiedAsset,
        target: { kind: binding.target.kind, id: targetId },
        createdAt,
      });
    }
    return Object.fromEntries(Object.entries(maps).map(([kind, map]) => [
      kind,
      Object.fromEntries(map),
    ]));
  }

  listComponentLineage(toVersionId) {
    return this.#database.prepare(`
      SELECT record_json FROM art_component_lineage
      WHERE to_version_id = ? ORDER BY rowid
    `).all(toVersionId).map(row => JSON.parse(row.record_json));
  }

  appendCandidateGraph({
    receipt,
    recordedAt,
    version,
    assetBinding,
    expectedState,
    componentReplacement = null,
    componentPolicy,
  }) {
    return this.#transaction(() => {
      if (!expectedState
          || typeof expectedState !== 'object'
          || expectedState.documentId !== version.documentId
          || expectedState.parentVersionId !== version.parentVersionIds[0]
          || !validateAssetRef(expectedState.inputAsset).ok
          || !validateAssetRef(expectedState.outputAsset).ok
          || !Number.isSafeInteger(expectedState.expectedDocumentRevision)
          || typeof expectedState.expectedCurrentVersionId !== 'string'
          || typeof expectedState.targetKind !== 'string'
          || (expectedState.componentId !== null && typeof expectedState.componentId !== 'string')
          || !Number.isSafeInteger(expectedState.componentRevision)
          || !/^[a-f0-9]{64}$/.test(expectedState.componentGraphDigest)
          || !['COPY_FORWARD', 'INVALIDATE_SPATIAL'].includes(componentPolicy)) {
        throw new Error('art_candidate_expected_state_invalid');
      }
      const targetComponent = expectedState.componentId === null
        ? null
        : this.#componentForTarget(expectedState.targetKind, expectedState.componentId);
      const replacementRequired = ['MASK', 'SELECTION'].includes(expectedState.targetKind)
        || (expectedState.targetKind === 'LAYER' && targetComponent.layerType !== 'GROUP');
      if (replacementRequired) {
        if (componentPolicy !== 'COPY_FORWARD') {
          throw new Error('art_candidate_component_policy_invalid');
        }
        if (!componentReplacement
            || componentReplacement.kind !== expectedState.targetKind
            || componentReplacement.id !== expectedState.componentId
            || !validateAssetRef(componentReplacement.assetRef).ok
            || !sameArtValue(componentReplacement.assetRef, expectedState.outputAsset)) {
          throw new Error('art_candidate_component_replacement_invalid');
        }
      } else if (componentReplacement !== null) {
        throw new Error('art_candidate_component_replacement_forbidden');
      }
      const snapshot = this.getDocumentSnapshot(expectedState.documentId);
      if (snapshot.documentRevision !== expectedState.expectedDocumentRevision
          || snapshot.currentVersion.versionId !== expectedState.expectedCurrentVersionId) {
        throw new Error('art_candidate_target_stale_at_commit');
      }
      const parentVersion = this.#versionContext(
        expectedState.documentId,
        expectedState.parentVersionId,
      );
      if (version.kind !== 'CANDIDATE'
          || version.parentVersionIds.length !== 1) {
        throw new Error('art_candidate_version_shape_invalid');
      }
      if (replacementRequired) {
        if (!sameArtValue(version.primaryAsset, parentVersion.primaryAsset)
            || version.primaryAssetStatus !== 'STALE_REQUIRES_COMPOSITE'
            || !sameArtValue(version.canvasExtent, parentVersion.canvasExtent)
            || version.colorSpace !== parentVersion.colorSpace) {
          throw new Error('art_candidate_component_primary_invalid');
        }
      } else if (!sameArtValue(version.primaryAsset, expectedState.outputAsset)
          || version.primaryAssetStatus !== 'CURRENT_RENDER') {
        throw new Error('art_candidate_output_primary_invalid');
      }
      const parentGraphSeal = this.getVersionGraphSeal(expectedState.parentVersionId);
      if (parentGraphSeal.componentDigest !== expectedState.componentGraphDigest) {
        throw new Error('art_candidate_component_graph_stale_at_commit');
      }
      this.#assetStore.verifyAsset(expectedState.inputAsset);
      if (expectedState.componentId !== null) {
        const component = targetComponent;
        const revision = component.revision ?? component.representation?.revision ?? 0;
        if (component.documentId !== expectedState.documentId
            || component.versionId !== expectedState.parentVersionId
            || revision !== expectedState.componentRevision) {
          throw new Error('art_candidate_component_stale_at_commit');
        }
      }
      if (receipt.schema !== 'eve-atelier-workbench-execution-receipt/v1'
          || receipt.status !== 'completed'
          || receipt.providerReceipt.target.kind !== `art.${expectedState.targetKind.toLowerCase()}`
          || receipt.providerReceipt.target.id
            !== (expectedState.componentId ?? expectedState.parentVersionId)
          || !receipt.inputAssets.some(item => sameArtValue(item, expectedState.inputAsset))
          || !sameArtValue(receipt.outputAsset, expectedState.outputAsset)
          || !receipt.providerReceipt.inputArtifacts.some(item => (
            item.artifactId === expectedState.inputAsset.assetId
            && item.sha256 === expectedState.inputAsset.sha256
          ))
          || !receipt.providerReceipt.outputArtifacts.some(item => (
            item.sha256 === expectedState.outputAsset.sha256
          ))) {
        throw new Error('art_candidate_receipt_asset_mismatch');
      }
      if (assetBinding.documentId !== version.documentId
          || assetBinding.versionId !== version.versionId
          || !sameArtValue(assetBinding.assetRef, version.primaryAsset)
          || assetBinding.target.kind !== 'DOCUMENT_VERSION'
          || assetBinding.target.id !== version.versionId) {
        throw new Error('art_candidate_asset_binding_mismatch');
      }
      const retainedReceipt = this.#appendExecutionReceipt(receipt, recordedAt);
      if (version.createdByExecutionId !== retainedReceipt.executionId) {
        throw new Error('art_candidate_execution_mismatch');
      }
      const retainedVersion = this.#appendVersion(version);
      const retainedBinding = this.#appendAssetBinding(assetBinding);
      const componentMap = this.#copyForwardComponents({
        fromVersionId: expectedState.parentVersionId,
        toVersionId: version.versionId,
        replacement: componentReplacement,
        createdAt: recordedAt,
        policy: componentPolicy,
      });
      const graphSeal = this.#sealVersionGraph({
        documentId: version.documentId,
        versionId: version.versionId,
        policy: componentPolicy,
        parentGraphDigest: parentGraphSeal.componentDigest,
        sealedAt: recordedAt,
      });
      return {
        receipt: retainedReceipt,
        version: retainedVersion,
        assetBinding: retainedBinding,
        componentMap,
        graphSeal,
      };
    });
  }

  #componentForTarget(kind, id) {
    switch (kind) {
      case 'LAYER': return this.getLayer(id);
      case 'MASK': return this.getMask(id);
      case 'SELECTION': return this.getSelection(id);
      case 'REGION': return this.getRegion(id);
      case 'STRUCTURE': return this.getStructureBinding(id);
      case 'FIELD': return this.getFieldBinding(id);
      default: throw new Error('art_candidate_component_kind_invalid');
    }
  }

  promoteCandidate(event) {
    return this.#transaction(() => this.#appendCurrentEvent(event));
  }

  restoreVersion(event) {
    return this.#transaction(() => this.#appendCurrentEvent(event));
  }

  close() {
    this.#database.close();
  }
}
