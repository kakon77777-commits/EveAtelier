import {
  isDenseJsonArray,
  isPlainJsonObject,
  normalizeCanonicalJsonValue,
} from '../operator-runtime/json-values.js';
import {
  AADS_TASK_TYPES,
  CONSTRAINT_DIMENSIONS,
} from '../visual-intelligence/contracts.js';

const absolutePath = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|users|var|tmp|opt)\/)/i;
const secret = /(?:BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,})/i;

function result(reason = null) {
  return reason === null ? { ok: true } : { ok: false, reason };
}

function exact(value, fields) {
  return isPlainJsonObject(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).every(key => fields.includes(key));
}

function string(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function strings(value, { empty = true } = {}) {
  return isDenseJsonArray(value)
    && (empty || value.length > 0)
    && value.every(string)
    && new Set(value).size === value.length;
}

function safe(value) {
  const encoded = JSON.stringify(value);
  return !absolutePath.test(encoded) && !secret.test(encoded);
}

export function normalizeSurfaceValue(value, reason = 'human_surface_json_value_invalid') {
  try {
    return normalizeCanonicalJsonValue(value);
  } catch {
    throw new TypeError(reason);
  }
}

export function validateWorkspaceKey(value) {
  if (!exact(value, ['projectId', 'documentId'])
      || !string(value.projectId)
      || !string(value.documentId)
      || !safe(value)) return result('human_surface_workspace_key_invalid');
  return result();
}

export function validateSurfaceIntentCommand(value) {
  if (!exact(value, [
    'projectId', 'documentId', 'text', 'taskTypeHint', 'roleBindingIds',
    'preferences', 'hardConstraints', 'overrides', 'retrievalContextRefs',
  ])
      || !string(value.projectId)
      || !string(value.documentId)
      || !string(value.text)
      || !AADS_TASK_TYPES.includes(value.taskTypeHint)
      || !strings(value.roleBindingIds)
      || !isDenseJsonArray(value.preferences)
      || !isDenseJsonArray(value.hardConstraints)
      || !isDenseJsonArray(value.overrides)
      || !strings(value.retrievalContextRefs)
      || !safe(value)) return result('human_surface_intent_command_invalid');
  for (const preference of value.preferences) {
    if (!exact(preference, ['kind', 'subjectRef', 'reason'])
        || !['LIKE', 'DISLIKE'].includes(preference.kind)
        || !string(preference.subjectRef)
        || !string(preference.reason)) return result('human_surface_intent_command_invalid');
  }
  for (const constraint of value.hardConstraints) {
    if (!exact(constraint, ['dimension', 'requirement'])
        || !CONSTRAINT_DIMENSIONS.includes(constraint.dimension)
        || !string(constraint.requirement)) return result('human_surface_intent_command_invalid');
  }
  for (const override of value.overrides) {
    if (!exact(override, ['scope', 'instruction'])
        || !string(override.scope)
        || !string(override.instruction)) return result('human_surface_intent_command_invalid');
  }
  return result();
}

export function validateSurfaceReviewCommand(value) {
  if (!exact(value, ['sessionId', 'decision', 'reason'])
      || !string(value.sessionId)
      || !['APPROVE', 'REJECT'].includes(value.decision)
      || !string(value.reason)
      || !safe(value)) return result('human_surface_review_command_invalid');
  return result();
}
