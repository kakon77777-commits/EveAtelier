import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  localizedRepairGenerateEvaluate,
  parseCliArgs,
  validateExecutionGate,
  validateLocalizedRepairConfig,
} from '../../scripts/real-mvp/run-character-remaster.mjs';
import { EveAtelierWorkbench } from '../../src/workbench.js';

const config = {
  sourceKind: 'rights_clear_real',
  provider: { type: 'comfyui' },
  evaluator: { model: { modelId: 'model:vision-v1' } },
};

const thresholds = {
  calibrationStatus: 'CALIBRATED',
  calibrationFixtureSet: 'fixture-set:real-v1',
};

test('parses a command and named file arguments without shell-dependent syntax', () => {
  assert.deepEqual(
    parseCliArgs(['generate-evaluate', '--config', 'run.json', '--state', 'state.json']),
    { command: 'generate-evaluate', config: 'run.json', state: 'state.json' },
  );
});

test('rejects external execution without explicit Real MVP opt-in', () => {
  assert.throws(
    () => validateExecutionGate({
      command: 'generate-evaluate',
      env: {},
      config,
      thresholds,
    }),
    /real_mvp_opt_in_required/,
  );
});

test('rejects fixture providers and uncalibrated thresholds before generation', () => {
  assert.throws(
    () => validateExecutionGate({
      command: 'generate-evaluate',
      env: { EVE_REAL_MVP: '1' },
      config: { ...config, provider: { type: 'fixture' } },
      thresholds,
    }),
    /fixture_provider_forbidden_for_real_run/,
  );
  assert.throws(
    () => validateExecutionGate({
      command: 'generate-evaluate',
      env: { EVE_REAL_MVP: '1' },
      config,
      thresholds: { ...thresholds, calibrationStatus: 'EXAMPLE_UNCALIBRATED' },
    }),
    /calibrated_thresholds_required/,
  );
});

test('allows private research assets only with a separate explicit opt-in', () => {
  const privateConfig = { ...config, sourceKind: 'private_research_authorized' };
  assert.throws(
    () => validateExecutionGate({
      command: 'generate-evaluate',
      env: { EVE_REAL_MVP: '1' },
      config: privateConfig,
      thresholds,
    }),
    /private_research_opt_in_required/,
  );
  assert.doesNotThrow(() => validateExecutionGate({
    command: 'generate-evaluate',
    env: { EVE_REAL_MVP: '1', EVE_PRIVATE_RESEARCH_APPROVED: '1' },
    config: privateConfig,
    thresholds,
  }));
});

test('rejects missing review evidence and candidate mismatch before promotion', () => {
  assert.throws(
    () => validateExecutionGate({
      command: 'review-promote-project',
      env: { EVE_REAL_MVP: '1' },
      config,
      thresholds,
      review: null,
      candidateVersionIds: ['document:character:v1'],
    }),
    /human_review_file_required/,
  );
  assert.throws(
    () => validateExecutionGate({
      command: 'review-promote-project',
      env: { EVE_REAL_MVP: '1' },
      config,
      thresholds,
      review: { candidateVersionId: 'document:character:v2' },
      candidateVersionIds: ['document:character:v1'],
    }),
    /human_review_candidate_mismatch/,
  );
});

test('requires an explicit bounded mask and locality thresholds for localized repair', () => {
  const repair = {
    taskId: 'character-remaster-private-001-repair-001',
    candidateCount: 2,
    baseSeed: 42001,
    intentText: ['repair only the declared regions'],
    mask: {
      width: 1280,
      height: 1280,
      featherRadius: 12,
      regions: [{ kind: 'rectangle', x: 0.2, y: 0.2, width: 0.1, height: 0.1 }],
    },
    localityThresholds: {
      maxMaskCoverage: 0.30,
      minInsideChangedPixels: 1,
      maxOutsideChangedPixels: 0,
      maxOutsideAbsoluteDelta: 0,
    },
  };

  assert.doesNotThrow(() => validateLocalizedRepairConfig(repair));
  assert.throws(
    () => validateLocalizedRepairConfig({ ...repair, mask: { ...repair.mask, regions: [] } }),
    /localized_repair_regions_required/,
  );
});

test('localized repair CLI stage writes resumable state, evidence, and review choices', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-localized-cli-'));
  const sourcePath = join(directory, 'source.png');
  const parentPath = join(directory, 'parent.png');
  await writeFile(sourcePath, 'source-bytes');
  await writeFile(parentPath, 'parent-bytes');
  const references = [];
  for (const role of ['line_reference', 'color_reference', 'negative_reference']) {
    const path = join(directory, `${role}.png`);
    await writeFile(path, `${role}-bytes`);
    references.push({ role, path: `${role}.png` });
  }
  const intentPath = join(directory, 'intent.json');
  const thresholdsPath = join(directory, 'thresholds.json');
  const configPath = join(directory, 'config.json');
  const statePath = join(directory, 'promoted-state.json');
  const runtimeDir = join(directory, 'runtime');
  await writeFile(intentPath, JSON.stringify({
    taskId: 'character-remaster-source-task',
    goal: 'character_remaster',
    sourceAsset: 'source.png',
    references,
    intentText: ['original intent'],
    constraints: { candidateCount: 2, humanReviewRequired: true, baseSeed: 1 },
  }));
  await writeFile(thresholdsPath, JSON.stringify({
    thresholdSetId: 'global:test',
    calibrationStatus: 'CALIBRATED',
    calibrationFixtureSet: 'fixture:test',
  }));
  await writeFile(configPath, JSON.stringify({
    projectId: 'project:localized-cli',
    documentId: 'document:localized-cli',
    sourceKind: 'private_research_authorized',
    fixtureRoot: directory,
    intentPath,
    thresholdsPath,
    runtimeDir,
    provider: { type: 'comfyui' },
    evaluator: { model: { modelId: 'model:test' } },
    localizedRepair: {
      taskId: 'candidate-02-localized-repair-001',
      candidateCount: 2,
      baseSeed: 42001,
      intentText: ['repair only the declared regions'],
      negativePrompt: 'identity drift',
      mask: {
        width: 16,
        height: 16,
        featherRadius: 0,
        regions: [{ kind: 'rectangle', x: 0.25, y: 0.25, width: 0.25, height: 0.25 }],
      },
      localityThresholds: {
        maxMaskCoverage: 0.30,
        minInsideChangedPixels: 1,
        maxOutsideChangedPixels: 0,
        maxOutsideAbsoluteDelta: 0,
      },
    },
  }));
  const workbench = new EveAtelierWorkbench({ projectId: 'project:localized-cli' });
  const source = workbench.createDocument({
    documentId: 'document:localized-cli',
    sourceAsset: sourcePath,
    promotionPolicy: 'automatic_deterministic',
  });
  const parentCandidate = workbench.stageCandidate({
    documentId: 'document:localized-cli',
    parentVersionId: source.versionId,
    assetPath: parentPath,
    evaluation: { verdict: 'ACCEPT' },
  });
  const parent = workbench.promoteCandidate({
    documentId: 'document:localized-cli',
    versionId: parentCandidate.versionId,
  });
  await writeFile(statePath, JSON.stringify(workbench.exportState()));
  const provider = {
    async probe() { return { available: true, providerId: 'provider:test' }; },
    async generateVariation(request) {
      await writeFile(request.outputPath, `repair-${request.seed}`);
      return {
        status: 'completed',
        mode: 'real',
        executionId: `execution-${request.seed}`,
        providerId: 'provider:test',
        providerVersion: '0.1.0',
        modelIdentity: { id: 'model:test', revision: 'test' },
        outputPath: request.outputPath,
      };
    },
  };
  const evaluator = {
    async probe() { return { available: true, evaluatorId: 'evaluator:test', modelId: 'model:evaluator' }; },
    async buildLocalizedRepairMask({ outputPath }) {
      await writeFile(outputPath, 'mask-bytes');
      return { width: 16, height: 16, nonZeroPixels: 16, maskCoverage: 0.0625, sha256: 'a'.repeat(64) };
    },
    async evaluate() { return { verdict: 'ACCEPT', warnings: [] }; },
    async evaluateLocalizedRepair() {
      return {
        sameDimensions: true,
        totalPixels: 256,
        maskPixels: 16,
        maskCoverage: 0.0625,
        insideChangedPixels: 12,
        outsideChangedPixels: 0,
        outsideMaxAbsoluteDelta: 0,
      };
    },
  };

  const result = await localizedRepairGenerateEvaluate({
    configPath,
    statePath,
    env: { EVE_REAL_MVP: '1', EVE_PRIVATE_RESEARCH_APPROVED: '1' },
    provider,
    evaluator,
  });

  const writtenState = JSON.parse(await readFile(result.statePath, 'utf8'));
  const document = writtenState.documents[0];
  const repairCandidates = document.versions.filter(version => version.parentVersionIds.includes(parent.versionId));
  const review = JSON.parse(await readFile(result.reviewPath, 'utf8'));
  const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8'));
  assert.equal(document.currentVersionId, parent.versionId);
  assert.equal(repairCandidates.length, 2);
  assert.equal(review.candidateChoices.length, 2);
  assert.equal(evidence.repair.parentVersionId, parent.versionId);
  assert.equal(evidence.repair.mask.maskCoverage, 0.0625);
});
