import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decideLocalizedRepairVerdict,
  LocalizedRepairRunner,
} from '../../src/character-remaster/localized-repair.js';
import { EveAtelierWorkbench } from '../../src/workbench.js';

const thresholds = {
  maxMaskCoverage: 0.30,
  minInsideChangedPixels: 1,
  maxOutsideChangedPixels: 0,
  maxOutsideAbsoluteDelta: 0,
};

const locality = {
  sameDimensions: true,
  totalPixels: 100,
  maskPixels: 20,
  maskCoverage: 0.20,
  insideChangedPixels: 12,
  outsideChangedPixels: 0,
  outsideMaxAbsoluteDelta: 0,
};

test('accepts a globally valid repair that changes only masked pixels', () => {
  const result = decideLocalizedRepairVerdict({
    globalEvaluation: { verdict: 'ACCEPT', warnings: [] },
    locality,
    thresholds,
  });

  assert.equal(result.verdict, 'ACCEPT');
  assert.deepEqual(result.failures, []);
  assert.equal(result.locality.maskCoverage, 0.20);
});

test('requests repair when any protected pixel changes outside the mask', () => {
  const result = decideLocalizedRepairVerdict({
    globalEvaluation: { verdict: 'ACCEPT', warnings: [] },
    locality: {
      ...locality,
      outsideChangedPixels: 1,
      outsideMaxAbsoluteDelta: 3,
    },
    thresholds,
  });

  assert.equal(result.verdict, 'REPAIR');
  assert.deepEqual(result.failures, ['outside_mask_changed']);
});

test('requests repair when the localized operation is a no-op', () => {
  const result = decideLocalizedRepairVerdict({
    globalEvaluation: { verdict: 'ACCEPT', warnings: [] },
    locality: { ...locality, insideChangedPixels: 0 },
    thresholds,
  });

  assert.equal(result.verdict, 'REPAIR');
  assert.deepEqual(result.failures, ['localized_repair_no_effect']);
});

test('rejects a repair mask that exceeds the bounded locality scope', () => {
  const result = decideLocalizedRepairVerdict({
    globalEvaluation: { verdict: 'ACCEPT', warnings: [] },
    locality: { ...locality, maskCoverage: 0.31 },
    thresholds,
  });

  assert.equal(result.verdict, 'REJECT');
  assert.deepEqual(result.failures, ['localized_repair_scope_too_large']);
});

test('does not accept locality evidence when the global evaluator requests repair', () => {
  const result = decideLocalizedRepairVerdict({
    globalEvaluation: { verdict: 'REPAIR', failures: ['identity_below_threshold'], warnings: [] },
    locality,
    thresholds,
  });

  assert.equal(result.verdict, 'REPAIR');
  assert.deepEqual(result.failures, ['global_evaluation_requires_repair']);
});

test('propagates global rejection and unverified evidence before locality acceptance', () => {
  for (const [globalVerdict, expectedVerdict, expectedFailure] of [
    ['REJECT', 'REJECT', 'global_evaluation_rejected'],
    ['UNVERIFIED', 'UNVERIFIED', 'global_evaluation_unverified'],
  ]) {
    const result = decideLocalizedRepairVerdict({
      globalEvaluation: { verdict: globalVerdict, warnings: [] },
      locality,
      thresholds,
    });
    assert.equal(result.verdict, expectedVerdict, globalVerdict);
    assert.deepEqual(result.failures, [expectedFailure], globalVerdict);
  }
});

test('rejects a localized repair whose dimensions no longer match its parent', () => {
  const result = decideLocalizedRepairVerdict({
    globalEvaluation: { verdict: 'ACCEPT', warnings: [] },
    locality: { ...locality, sameDimensions: false },
    thresholds,
  });

  assert.equal(result.verdict, 'REJECT');
  assert.deepEqual(result.failures, ['localized_repair_dimensions_changed']);
});

test('keeps localized repair unverified when locality thresholds are incomplete', () => {
  const result = decideLocalizedRepairVerdict({
    globalEvaluation: { verdict: 'ACCEPT', warnings: [] },
    locality,
    thresholds: { maxMaskCoverage: 0.30 },
  });

  assert.equal(result.verdict, 'UNVERIFIED');
  assert.deepEqual(result.failures, ['localized_repair_thresholds_required']);
});

test('keeps localized repair unverified when global evaluation is missing', () => {
  const result = decideLocalizedRepairVerdict({ locality, thresholds });

  assert.equal(result.verdict, 'UNVERIFIED');
  assert.deepEqual(result.failures, ['global_evaluation_required']);
});

test('stages repair candidates from the current parent without mutating or promoting it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-localized-runner-'));
  const sourcePath = join(directory, 'source.png');
  const parentPath = join(directory, 'parent.png');
  const maskPath = join(directory, 'mask.png');
  await writeFile(sourcePath, 'original-source-bytes');
  await writeFile(parentPath, 'accepted-parent-bytes');
  await writeFile(maskPath, 'bounded-mask-bytes');

  const workbench = new EveAtelierWorkbench({ projectId: 'project:localized' });
  const source = workbench.createDocument({
    documentId: 'document:localized',
    sourceAsset: sourcePath,
    promotionPolicy: 'automatic_deterministic',
  });
  const parentCandidate = workbench.stageCandidate({
    documentId: 'document:localized',
    parentVersionId: source.versionId,
    assetPath: parentPath,
    evaluation: { verdict: 'ACCEPT' },
  });
  const parent = workbench.promoteCandidate({
    documentId: 'document:localized',
    versionId: parentCandidate.versionId,
  });
  const seenRequests = [];
  const provider = {
    async generateVariation(request) {
      seenRequests.push(structuredClone(request));
      await writeFile(request.outputPath, `repair-seed-${request.seed}`);
      return {
        status: 'completed',
        mode: 'fixture',
        executionId: `repair-execution-${request.seed}`,
        providerId: 'provider:test-localized',
        providerVersion: '0.1.0',
        modelIdentity: { id: 'fixture:repair-model', revision: 'test' },
        outputPath: request.outputPath,
      };
    },
  };
  const evaluator = {
    async evaluate() {
      return { verdict: 'ACCEPT', warnings: [] };
    },
    async evaluateLocalizedRepair() {
      return locality;
    },
  };

  const result = await new LocalizedRepairRunner().run({
    workbench,
    documentId: 'document:localized',
    parentVersionId: parent.versionId,
    identitySourcePath: sourcePath,
    maskPath,
    references: [],
    provider,
    evaluator,
    workingDir: directory,
    taskId: 'localized-repair-001',
    intentText: ['repair only the declared mask'],
    negativePrompt: 'identity drift',
    candidateCount: 2,
    baseSeed: 900,
    globalThresholds: { thresholdSetId: 'global:test' },
    localityThresholds: thresholds,
  });

  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map(item => item.parentVersionIds), [
    [parent.versionId],
    [parent.versionId],
  ]);
  assert.deepEqual(result.candidates.map(item => item.evaluation.verdict), ['ACCEPT', 'ACCEPT']);
  assert.equal(workbench.getCurrentVersion('document:localized').versionId, parent.versionId);
  assert.deepEqual(seenRequests.map(item => item.operatorId), [
    'visual.op.generative.inpaint',
    'visual.op.generative.inpaint',
  ]);
  assert.equal(new Set(seenRequests.map(item => item.seed)).size, 2);
  assert.equal(seenRequests[0].source.sha256, parent.assetHash);
  assert.match(seenRequests[0].mask.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.identitySourceHashBefore, result.identitySourceHashAfter);
  assert.equal(result.parentHashBefore, result.parentHashAfter);
  assert.equal(result.maskHashBefore, result.maskHashAfter);
});

test('rejects a stale repair parent before provider dispatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-localized-stale-'));
  const sourcePath = join(directory, 'source.png');
  const firstPath = join(directory, 'first.png');
  const currentPath = join(directory, 'current.png');
  const maskPath = join(directory, 'mask.png');
  await writeFile(sourcePath, 'source');
  await writeFile(firstPath, 'first-parent');
  await writeFile(currentPath, 'new-current');
  await writeFile(maskPath, 'mask');
  const workbench = new EveAtelierWorkbench({ projectId: 'project:stale' });
  const source = workbench.createDocument({
    documentId: 'document:stale',
    sourceAsset: sourcePath,
    promotionPolicy: 'automatic_deterministic',
  });
  const first = workbench.stageCandidate({
    documentId: 'document:stale',
    parentVersionId: source.versionId,
    assetPath: firstPath,
    evaluation: { verdict: 'ACCEPT' },
  });
  workbench.promoteCandidate({ documentId: 'document:stale', versionId: first.versionId });
  const current = workbench.stageCandidate({
    documentId: 'document:stale',
    parentVersionId: first.versionId,
    assetPath: currentPath,
    evaluation: { verdict: 'ACCEPT' },
  });
  workbench.promoteCandidate({ documentId: 'document:stale', versionId: current.versionId });
  let providerCalls = 0;
  const provider = {
    async generateVariation(request) {
      providerCalls += 1;
      await writeFile(request.outputPath, 'unexpected');
      return {
        status: 'completed',
        executionId: 'unexpected',
        providerId: 'provider:unexpected',
        providerVersion: '0.1.0',
        modelIdentity: { id: 'unexpected' },
        outputPath: request.outputPath,
      };
    },
  };
  const evaluator = {
    async evaluate() { return { verdict: 'ACCEPT', warnings: [] }; },
    async evaluateLocalizedRepair() { return locality; },
  };

  await assert.rejects(() => new LocalizedRepairRunner().run({
    workbench,
    documentId: 'document:stale',
    parentVersionId: first.versionId,
    identitySourcePath: sourcePath,
    maskPath,
    references: [],
    provider,
    evaluator,
    workingDir: directory,
    taskId: 'stale-repair',
    intentText: ['repair'],
    candidateCount: 2,
    baseSeed: 10,
    globalThresholds: {},
    localityThresholds: thresholds,
  }), /localized_repair_parent_not_current/);
  assert.equal(providerCalls, 0);
});
