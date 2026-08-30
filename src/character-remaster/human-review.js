const dispositions = new Set(['APPROVE', 'REJECT', 'ACCEPT_WITH_WARNINGS']);

export function validateHumanReview(value, candidateVersionId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('human_review_must_be_object');
  }
  if (typeof value.reviewId !== 'string' || value.reviewId.length === 0) {
    throw new TypeError('human_review_id_required');
  }
  if (value.candidateVersionId !== candidateVersionId) {
    throw new Error('human_review_candidate_mismatch');
  }
  if (!value.reviewer
      || value.reviewer.kind !== 'human'
      || typeof value.reviewer.id !== 'string'
      || value.reviewer.id.length === 0) {
    throw new TypeError('human_reviewer_required');
  }
  if (!dispositions.has(value.disposition)) throw new Error('human_review_disposition_invalid');
  if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
    throw new TypeError('human_review_reason_required');
  }
  if (typeof value.reviewedAt !== 'string' || Number.isNaN(Date.parse(value.reviewedAt))) {
    throw new TypeError('human_review_timestamp_invalid');
  }
  if (value.evidenceClass !== 'human_observed') {
    throw new Error('human_review_evidence_class_invalid');
  }
  return structuredClone(value);
}
