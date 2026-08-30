function generationBlockers(evidence) {
  const blockers = [];
  if (evidence?.status !== 'completed' || evidence?.mode !== 'real') {
    blockers.push('real_generation_provider_required');
  }
  if (evidence?.sourceKind !== 'rights_clear_real') {
    blockers.push('rights_clear_source_reference_pack_required');
  }
  if (!Number.isInteger(evidence?.candidateCount)
      || evidence.candidateCount < 2
      || !Array.isArray(evidence.artifactHashes)
      || evidence.artifactHashes.length < 2) {
    blockers.push('at_least_two_real_candidates_required');
  }
  return blockers;
}

function evaluationBlockers(evidence) {
  const blockers = [];
  if (evidence?.status !== 'completed'
      || evidence?.mode !== 'real'
      || typeof evidence?.evaluatorId !== 'string'
      || typeof evidence?.modelId !== 'string'
      || typeof evidence?.acceptedCandidateId !== 'string') {
    blockers.push('real_evaluator_required');
  }
  if (evidence?.calibrationStatus !== 'CALIBRATED') {
    blockers.push('calibrated_thresholds_required');
  }
  return blockers;
}

function humanReviewBlockers(evidence) {
  if (evidence?.evidenceClass === 'human_observed'
      && ['APPROVE', 'ACCEPT_WITH_WARNINGS'].includes(evidence?.disposition)
      && typeof evidence?.candidateVersionId === 'string') return [];
  return ['human_observed_review_required'];
}

function promotionBlockers(evidence) {
  if (evidence?.success === true && typeof evidence?.currentVersionId === 'string') return [];
  return ['workbench_promotion_required'];
}

function mrmicBlockers(evidence) {
  if (evidence?.live === true
      && evidence?.evidenceClass === 'live_local_integration'
      && evidence?.candidateVerified === true
      && evidence?.promotedVerified === true
      && evidence?.rendered === true
      && evidence?.ownershipTransferred === false) return [];
  return ['live_mrmic_candidate_and_promoted_projection_required'];
}

function verificationBlockers(evidence) {
  if (evidence?.checkPass === true
      && Number.isInteger(evidence?.tests?.pass)
      && evidence.tests.pass > 0
      && evidence.tests.fail === 0) return [];
  return ['full_verification_required'];
}

export function classifyRealMvpEvidence(evidence = {}) {
  const groups = [
    ['real_generation', generationBlockers(evidence.generation)],
    ['real_evaluation', evaluationBlockers(evidence.evaluation)],
    ['human_review', humanReviewBlockers(evidence.humanReview)],
    ['workbench_promotion', promotionBlockers(evidence.promotion)],
    ['live_mrmic', mrmicBlockers(evidence.mrmic)],
    ['full_verification', verificationBlockers(evidence.verification)],
  ];
  const passedGates = groups.filter(([, blockers]) => blockers.length === 0).map(([gate]) => gate);
  const blockers = groups.flatMap(([, values]) => values);
  if (evidence.generation?.attempted === true
      && evidence.generation?.status === 'failed'
      && (!Array.isArray(evidence.generation.artifactHashes)
        || evidence.generation.artifactHashes.length === 0)) {
    blockers.unshift('real_generation_failed_without_artifact');
  }
  const result = blockers.length === 0
    ? 'PASS'
    : blockers.includes('real_generation_failed_without_artifact') && passedGates.length === 0
      ? 'FAIL'
      : 'PARTIAL';
  return { result, passedGates, blockers: [...new Set(blockers)] };
}

const secretKey = /(authorization|bearer|token|secret|credential|password)/i;
const absolutePath = /^(?:[a-zA-Z]:[\\/]|\\\\|\/(?:home|users|var|tmp|opt)\/)/;

function sanitize(value, key = '') {
  if (secretKey.test(key)) return undefined;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return '[redacted-binary]';
  if (typeof value === 'string') return absolutePath.test(value) ? '[redacted-local-path]' : value;
  if (Array.isArray(value)) return value.map(item => sanitize(item)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)])
      .filter(([, childValue]) => childValue !== undefined),
  );
}

export function sanitizeRealMvpEvidence(evidence) {
  return sanitize(evidence);
}
