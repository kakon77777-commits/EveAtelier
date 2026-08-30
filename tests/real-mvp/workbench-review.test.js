import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EveAtelierWorkbench } from '../../src/workbench.js';
import { validateHumanReview } from '../../src/character-remaster/human-review.js';

async function preparedCandidate({ disposition = 'APPROVE' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'eve-workbench-review-'));
  const source = join(directory, 'source.png');
  const output = join(directory, 'candidate.png');
  await writeFile(source, 'source-artifact');
  await writeFile(output, 'candidate-artifact');
  const workbench = new EveAtelierWorkbench({ projectId: 'project:real-mvp' });
  const original = workbench.createDocument({
    documentId: 'document:character-001',
    sourceAsset: source,
    promotionPolicy: 'human_required',
  });
  const candidate = workbench.stageCandidate({
    documentId: 'document:character-001',
    parentVersionId: original.versionId,
    assetPath: output,
    execution: { executionId: 'execution:candidate-1' },
    evaluation: { verdict: 'ACCEPT', scores: { identity: 0.82 } },
  });
  const review = {
    reviewId: 'review:character-001:candidate-1',
    candidateVersionId: candidate.versionId,
    reviewer: { kind: 'human', id: 'local-owner' },
    disposition,
    reason: 'Identity and low-saturation wuxia direction are retained.',
    reviewedAt: '2026-08-30T14:00:00.000Z',
    evidenceClass: 'human_observed',
  };
  return { directory, source, output, workbench, candidate, review };
}

test('human-required promotion needs an approving structured review', async () => {
  const { workbench, candidate, review } = await preparedCandidate();
  assert.throws(
    () => workbench.promoteCandidate({
      documentId: 'document:character-001',
      versionId: candidate.versionId,
      approvedBy: 'human:unrecorded',
    }),
    /human_approval_required/,
  );

  assert.deepEqual(validateHumanReview(review, candidate.versionId), review);
  const reviewed = workbench.recordHumanReview({
    documentId: 'document:character-001',
    versionId: candidate.versionId,
    review,
  });
  assert.deepEqual(reviewed.humanReview, review);

  const promoted = workbench.promoteCandidate({
    documentId: 'document:character-001',
    versionId: candidate.versionId,
  });
  assert.equal(promoted.status, 'current');
  assert.equal(promoted.approvedBy, 'human:local-owner');
});

test('a rejected human review blocks an otherwise accepted candidate', async () => {
  const { workbench, candidate, review } = await preparedCandidate({ disposition: 'REJECT' });
  workbench.recordHumanReview({
    documentId: 'document:character-001',
    versionId: candidate.versionId,
    review,
  });
  assert.throws(
    () => workbench.promoteCandidate({
      documentId: 'document:character-001',
      versionId: candidate.versionId,
    }),
    /human_review_rejected/,
  );
});

test('exported workbench state restores hashes, review, lineage, and current version', async () => {
  const { workbench, candidate, review } = await preparedCandidate();
  workbench.recordHumanReview({
    documentId: 'document:character-001',
    versionId: candidate.versionId,
    review,
  });
  workbench.promoteCandidate({
    documentId: 'document:character-001',
    versionId: candidate.versionId,
  });

  const restored = EveAtelierWorkbench.fromState(workbench.exportState());
  assert.deepEqual(
    restored.getDocument('document:character-001'),
    workbench.getDocument('document:character-001'),
  );
});

test('state restore rejects candidate bytes that drifted after export', async () => {
  const { workbench, output } = await preparedCandidate();
  const state = workbench.exportState();
  await writeFile(output, 'mutated-candidate-artifact');
  assert.throws(
    () => EveAtelierWorkbench.fromState(state),
    /asset_hash_mismatch:document:character-001:v1/,
  );
});
