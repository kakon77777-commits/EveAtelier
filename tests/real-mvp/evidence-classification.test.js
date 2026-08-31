import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRealMvpEvidence,
  sanitizeRealMvpEvidence,
} from '../../src/character-remaster/evidence.js';

function completeEvidence() {
  return {
    schema: 'eve-atelier-real-mvp-evidence/v1',
    taskId: 'character-remaster-001',
    generation: {
      attempted: true,
      status: 'completed',
      mode: 'real',
      sourceKind: 'rights_clear_real',
      candidateCount: 2,
      artifactHashes: ['a'.repeat(64), 'b'.repeat(64)],
    },
    evaluation: {
      status: 'completed',
      mode: 'real',
      evaluatorId: 'evaluator:clip-hybrid',
      modelId: 'model:vision-v1',
      calibrationStatus: 'CALIBRATED',
      acceptedCandidateId: 'document:character:v1',
    },
    humanReview: {
      candidateVersionId: 'document:character:v1',
      disposition: 'APPROVE',
      evidenceClass: 'human_observed',
    },
    promotion: {
      success: true,
      currentVersionId: 'document:character:v1',
    },
    mrmic: {
      live: true,
      evidenceClass: 'live_local_integration',
      candidateVerified: true,
      promotedVerified: true,
      rendered: true,
      ownershipTransferred: false,
    },
    verification: {
      checkPass: true,
      tests: { pass: 50, fail: 0, skipped: 1 },
    },
  };
}

test('classifies only complete real evidence as Real MVP PASS', () => {
  const result = classifyRealMvpEvidence(completeEvidence());
  assert.equal(result.result, 'PASS');
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.passedGates, [
    'real_generation',
    'real_evaluation',
    'human_review',
    'workbench_promotion',
    'live_mrmic',
    'full_verification',
  ]);
});

test('keeps fixture, one-candidate, automated-review, and mock-MRMIC evidence partial', () => {
  const cases = [
    ['fixture generation', evidence => { evidence.generation.mode = 'fixture'; }, 'real_generation_provider_required'],
    ['one candidate', evidence => { evidence.generation.candidateCount = 1; }, 'at_least_two_real_candidates_required'],
    ['automated review', evidence => { evidence.humanReview.evidenceClass = 'automated_contract'; }, 'human_observed_review_required'],
    ['mock MRMIC', evidence => { evidence.mrmic.evidenceClass = 'mock_contract'; }, 'live_mrmic_candidate_and_promoted_projection_required'],
    ['uncalibrated evaluator', evidence => { evidence.evaluation.calibrationStatus = 'EXAMPLE_UNCALIBRATED'; }, 'calibrated_thresholds_required'],
  ];
  for (const [name, mutate, blocker] of cases) {
    const evidence = completeEvidence();
    mutate(evidence);
    const result = classifyRealMvpEvidence(evidence);
    assert.equal(result.result, 'PARTIAL', name);
    assert.ok(result.blockers.includes(blocker), name);
  }
});

test('reports an attempted provider failure with no retained gate as FAIL', () => {
  const result = classifyRealMvpEvidence({
    schema: 'eve-atelier-real-mvp-evidence/v1',
    generation: { attempted: true, status: 'failed', mode: 'real', candidateCount: 0 },
  });
  assert.equal(result.result, 'FAIL');
  assert.ok(result.blockers.includes('real_generation_failed_without_artifact'));
});

test('sanitizes secrets and absolute local paths from shareable evidence', () => {
  const sanitized = sanitizeRealMvpEvidence({
    bearerToken: 'secret-value',
    sourcePath: 'D:\\private\\source.png',
    nested: {
      cachePath: 'C:\\Users\\person\\.cache\\model',
      logicalId: 'artasset://character/candidate/1',
    },
  });
  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes('secret-value'), false);
  assert.equal(serialized.includes('D:\\\\private'), false);
  assert.equal(serialized.includes('C:\\\\Users'), false);
  assert.equal(sanitized.nested.logicalId, 'artasset://character/candidate/1');
});
