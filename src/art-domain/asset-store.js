import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isCanonicalInstant } from '../operator-runtime/time.js';
import { validateAssetRef } from './contracts.js';

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assetRef(row) {
  return {
    assetId: row.asset_id,
    sha256: row.sha256,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
  };
}

function appendOnlyTriggers(table, conflictWhen) {
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

export class AssetStore {
  #root;
  #database;

  constructor({ root }) {
    if (typeof root !== 'string' || root.trim().length === 0) {
      throw new TypeError('asset_store_root_required');
    }
    this.#root = resolve(root);
    mkdirSync(join(this.#root, 'objects'), { recursive: true });
    this.#database = new DatabaseSync(join(this.#root, 'asset-index.sqlite3'));
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        asset_id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        media_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        relative_key TEXT NOT NULL UNIQUE,
        registered_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS asset_lineage (
        event_id TEXT PRIMARY KEY,
        child_asset_id TEXT NOT NULL,
        parent_asset_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(child_asset_id, parent_asset_id, execution_id),
        FOREIGN KEY (child_asset_id) REFERENCES assets(asset_id),
        FOREIGN KEY (parent_asset_id) REFERENCES assets(asset_id)
      ) STRICT;

      ${appendOnlyTriggers('assets', 'asset_id = NEW.asset_id OR sha256 = NEW.sha256 OR relative_key = NEW.relative_key')}
      ${appendOnlyTriggers('asset_lineage', 'event_id = NEW.event_id OR (child_asset_id = NEW.child_asset_id AND parent_asset_id = NEW.parent_asset_id AND execution_id = NEW.execution_id)')}
    `);
  }

  registerFile({ sourcePath, mediaType, registeredAt }) {
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
      throw new TypeError('asset_source_path_required');
    }
    if (typeof mediaType !== 'string' || mediaType.length === 0) {
      throw new TypeError('asset_media_type_required');
    }
    if (!isCanonicalInstant(registeredAt)) throw new Error('asset_registered_at_invalid');
    const source = resolve(sourcePath);
    const stats = statSync(source);
    if (!stats.isFile()) throw new Error('asset_source_not_file');
    const digest = fileHash(source);
    const id = `asset:sha256:${digest}`;
    const existing = this.#database.prepare(`
      SELECT * FROM assets WHERE asset_id = ?
    `).get(id);
    if (existing) {
      if (existing.media_type !== mediaType || Number(existing.byte_size) !== stats.size) {
        throw new Error('asset_registration_metadata_conflict');
      }
      const retained = assetRef(existing);
      this.verifyAsset(retained);
      return retained;
    }

    const relativeKey = join('objects', digest.slice(0, 2), digest);
    const destination = join(this.#root, relativeKey);
    mkdirSync(dirname(destination), { recursive: true });
    if (!existsSync(destination)) {
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        copyFileSync(source, temporary);
        if (fileHash(temporary) !== digest) throw new Error('asset_copy_hash_mismatch');
        if (existsSync(destination)) {
          unlinkSync(temporary);
        } else {
          try {
            renameSync(temporary, destination);
          } catch (error) {
            if (!existsSync(destination) || fileHash(destination) !== digest) throw error;
            unlinkSync(temporary);
          }
        }
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
    }
    if (fileHash(destination) !== digest) throw new Error('asset_store_object_hash_mismatch');
    try {
      this.#database.prepare(`
        INSERT INTO assets (
          asset_id, sha256, media_type, byte_size, relative_key, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, digest, mediaType, stats.size, relativeKey, registeredAt);
    } catch (error) {
      const winner = this.#database.prepare('SELECT * FROM assets WHERE asset_id = ?').get(id);
      if (!winner
          || winner.sha256 !== digest
          || winner.media_type !== mediaType
          || Number(winner.byte_size) !== stats.size
          || winner.relative_key !== relativeKey) throw error;
      const retained = assetRef(winner);
      this.verifyAsset(retained);
      return retained;
    }
    return { assetId: id, sha256: digest, mediaType, byteSize: stats.size };
  }

  registerDerivedFile({
    sourcePath,
    mediaType,
    registeredAt,
    parentAssetIds,
    executionId,
    lineageEventPrefix,
  }) {
    if (!Array.isArray(parentAssetIds)
        || parentAssetIds.length === 0
        || new Set(parentAssetIds).size !== parentAssetIds.length
        || parentAssetIds.some(id => typeof id !== 'string' || id.length === 0)) {
      throw new TypeError('asset_lineage_parents_required');
    }
    if (typeof executionId !== 'string' || executionId.length === 0) {
      throw new TypeError('asset_lineage_execution_required');
    }
    if (typeof lineageEventPrefix !== 'string' || lineageEventPrefix.length === 0) {
      throw new TypeError('asset_lineage_event_prefix_required');
    }
    for (const parentId of parentAssetIds) this.getAsset(parentId);
    const child = this.registerFile({ sourcePath, mediaType, registeredAt });
    const insert = this.#database.prepare(`
      INSERT INTO asset_lineage (
        event_id, child_asset_id, parent_asset_id, execution_id, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (let index = 0; index < parentAssetIds.length; index += 1) {
      const parentId = parentAssetIds[index];
      const eventId = `${lineageEventPrefix}:${index + 1}`;
      const existing = this.#database.prepare(`
        SELECT child_asset_id, parent_asset_id, execution_id, created_at
        FROM asset_lineage WHERE event_id = ?
      `).get(eventId);
      if (existing) {
        if (existing.child_asset_id !== child.assetId
            || existing.parent_asset_id !== parentId
            || existing.execution_id !== executionId
            || existing.created_at !== registeredAt) {
          throw new Error('asset_lineage_event_conflict');
        }
      } else {
        insert.run(eventId, child.assetId, parentId, executionId, registeredAt);
      }
    }
    return child;
  }

  getAsset(assetId) {
    const row = this.#database.prepare('SELECT * FROM assets WHERE asset_id = ?').get(assetId);
    if (!row) throw new Error('asset_not_found');
    const retained = assetRef(row);
    this.verifyAsset(retained);
    return retained;
  }

  getPath(asset) {
    const validation = validateAssetRef(asset);
    if (!validation.ok) throw new Error(validation.reason);
    const row = this.#database.prepare(`
      SELECT relative_key, sha256, media_type, byte_size FROM assets WHERE asset_id = ?
    `).get(asset.assetId);
    if (!row) throw new Error('asset_not_found');
    if (row.sha256 !== asset.sha256.toLowerCase()
        || row.media_type !== asset.mediaType
        || Number(row.byte_size) !== asset.byteSize) {
      throw new Error('asset_ref_mismatch');
    }
    return join(this.#root, row.relative_key);
  }

  verifyAsset(asset) {
    const path = this.getPath(asset);
    const stats = statSync(path);
    if (!stats.isFile()
        || stats.size !== asset.byteSize
        || fileHash(path) !== asset.sha256.toLowerCase()) {
      throw new Error('asset_bytes_mismatch');
    }
    return true;
  }

  listLineage(childAssetId) {
    return this.#database.prepare(`
      SELECT event_id AS eventId, child_asset_id AS childAssetId,
             parent_asset_id AS parentAssetId, execution_id AS executionId,
             created_at AS createdAt
      FROM asset_lineage WHERE child_asset_id = ? ORDER BY event_id
    `).all(childAssetId);
  }

  close() {
    this.#database.close();
  }
}
