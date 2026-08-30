import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export const REQUIRED_REFERENCE_ROLES = Object.freeze([
  'line_reference',
  'color_reference',
  'negative_reference',
]);

export const OPTIONAL_REFERENCE_ROLES = Object.freeze([
  'quality_reference',
  'identity_reference',
]);

const allowedReferenceRoles = new Set([
  ...REQUIRED_REFERENCE_ROLES,
  ...OPTIONAL_REFERENCE_ROLES,
]);

function fileIdentity(path, label) {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError(`${label}_path_required`);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new Error(`${label}_not_found:${path}`);
  }
  if (!stats.isFile()) throw new Error(`${label}_not_file:${path}`);
  return {
    path,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    bytes: stats.size,
  };
}

export function validateCharacterRemasterIntent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'intent_must_be_object' };
  }
  if (typeof value.taskId !== 'string' || value.taskId.length === 0) {
    return { ok: false, reason: 'task_id_required' };
  }
  if (value.goal !== 'character_remaster') {
    return { ok: false, reason: 'goal_must_be_character_remaster' };
  }
  if (!Array.isArray(value.intentText)
      || value.intentText.length === 0
      || value.intentText.some(line => typeof line !== 'string' || line.trim().length === 0)) {
    return { ok: false, reason: 'intent_text_required' };
  }
  if (!value.constraints || typeof value.constraints !== 'object' || Array.isArray(value.constraints)) {
    return { ok: false, reason: 'constraints_required' };
  }
  const { candidateCount, humanReviewRequired, baseSeed = 0 } = value.constraints;
  if (!Number.isInteger(candidateCount) || candidateCount < 2 || candidateCount > 4) {
    return { ok: false, reason: 'candidate_count_must_be_2_to_4' };
  }
  if (humanReviewRequired !== true) {
    return { ok: false, reason: 'human_review_must_be_required' };
  }
  if (!Number.isSafeInteger(baseSeed) || baseSeed < 0) {
    return { ok: false, reason: 'base_seed_must_be_non_negative_integer' };
  }
  return { ok: true };
}

export function bindReferenceRoles({ sourceAsset, references } = {}) {
  const source = fileIdentity(sourceAsset, 'source_asset');
  if (!Array.isArray(references)) throw new TypeError('references_required');

  const byRole = {};
  const bound = [];
  for (const reference of references) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw new TypeError('reference_must_be_object');
    }
    if (!allowedReferenceRoles.has(reference.role)) {
      throw new Error(`unsupported_reference_role:${reference.role ?? ''}`);
    }
    if (byRole[reference.role]) throw new Error(`duplicate_reference_role:${reference.role}`);
    const identity = { role: reference.role, ...fileIdentity(reference.path, `reference_${reference.role}`) };
    bound.push(identity);
    byRole[reference.role] = identity;
  }

  for (const role of REQUIRED_REFERENCE_ROLES) {
    if (!byRole[role]) throw new Error(`missing_reference_role:${role}`);
  }

  return { source, references: bound, byRole };
}

export function buildGenerationRequest({ intent, assets, candidateIndex, outputPath } = {}) {
  const validation = validateCharacterRemasterIntent(intent);
  if (!validation.ok) throw new Error(validation.reason);
  if (!assets?.source || !Array.isArray(assets.references)) throw new TypeError('bound_assets_required');
  if (!Number.isInteger(candidateIndex)
      || candidateIndex < 0
      || candidateIndex >= intent.constraints.candidateCount) {
    throw new RangeError('candidate_index_out_of_range');
  }
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new TypeError('output_path_required');
  }

  return {
    operationId: `${intent.taskId}:candidate:${candidateIndex + 1}`,
    operatorId: 'visual.op.generative.generate_variation',
    source: structuredClone(assets.source),
    references: structuredClone(assets.references),
    intentText: [...intent.intentText],
    constraints: structuredClone(intent.constraints),
    seed: (intent.constraints.baseSeed ?? 0) + candidateIndex,
    outputPath,
  };
}
