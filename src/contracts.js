const receiptStatuses = new Set([
  'prepared', 'running', 'completed', 'failed', 'cancelled', 'timed_out', 'stale', 'rejected',
]);
const reproducibilityModes = new Set([
  'exact', 'best_effort', 'seeded_stochastic', 'non_reproducible', 'unknown',
]);

export function validateOperatorRequest(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'request_must_be_object' };
  if (typeof value.operatorId !== 'string' || !value.operatorId.startsWith('visual.op.')) {
    return { ok: false, reason: 'operator_id_must_be_visual_namespace' };
  }
  if (typeof value.operationId !== 'string' || value.operationId.length === 0) {
    return { ok: false, reason: 'operation_id_required' };
  }
  if (!value.target || typeof value.target.kind !== 'string' || typeof value.target.id !== 'string') {
    return { ok: false, reason: 'target_required' };
  }
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) {
    return { ok: false, reason: 'expected_revision_required' };
  }
  return { ok: true };
}

export function validateProviderReceipt(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'receipt_must_be_object' };
  const requiredStrings = [
    'executionId', 'operationId', 'operatorId', 'providerId', 'providerVersion',
    'startedAt', 'finishedAt', 'reproducibility', 'status',
  ];
  for (const key of requiredStrings) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      return { ok: false, reason: `${key}_required` };
    }
  }
  if (!value.operatorId.startsWith('visual.op.')) {
    return { ok: false, reason: 'operator_id_must_be_visual_namespace' };
  }
  if (!receiptStatuses.has(value.status)) return { ok: false, reason: 'invalid_status' };
  if (!reproducibilityModes.has(value.reproducibility)) {
    return { ok: false, reason: 'invalid_reproducibility' };
  }
  if (!Array.isArray(value.inputRefs) || !Array.isArray(value.outputRefs)) {
    return { ok: false, reason: 'input_output_refs_required' };
  }
  return { ok: true };
}
