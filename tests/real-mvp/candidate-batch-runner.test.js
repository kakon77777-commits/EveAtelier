import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindReferenceRoles } from '../../src/character-remaster/contracts.js';
import { CandidateBatchRunner } from '../../src/character-remaster/candidate-batch-runner.js';
import { EveAtelierWorkbench } from '../../src/workbench.js';

async function fixturePack() {
  const directory = await mkdtemp(join(tmpdir(), 'eve-remaster-batch-'));
  const sourceAsset = join(directory, 'source.png');
  await writeFile(sourceAsset, 'source-remains-byte-identical');
  const references = [];
  for (const role of ['line_reference', 'color_reference', 'negative_reference']) {
    const path = join(directory, `${role}.png`);
    await writeFile(path, `${role}-bytes`);
    references.push({ role, path });
  }
  return { directory, sourceAsset, references };
}

test('stages and independently evaluates a candidate batch without promoting it', async () => {
  const pack = await fixturePack();
  const assets = bindReferenceRoles(pack);
  const intent = {
    taskId: 'character-remaster-batch-001',
    goal: 'character_remaster',
    intentText: ['Preserve identity', 'Low-saturation wuxia direction'],
    constraints: {
      candidateCount: 2,
      humanReviewRequired: true,
      baseSeed: 71,
    },
  };
  const workbench = new EveAtelierWorkbench({ projectId: 'project:batch' });
  const sourceVersion = workbench.createDocument({
    documentId: 'document:batch',
    sourceAsset: pack.sourceAsset,
    promotionPolicy: 'human_required',
  });
  const provider = {
    async generateVariation(request) {
      await writeFile(request.outputPath, `candidate-seed-${request.seed}`);
      return {
        status: 'completed',
        mode: 'fixture',
        executionId: `provider-execution-${request.seed}`,
        providerId: 'provider:test-generation',
        providerVersion: '0.1.0',
        modelIdentity: { id: 'fixture:model', revision: 'test' },
        outputPath: request.outputPath,
      };
    },
  };
  const evaluator = {
    async evaluate({ candidatePath }) {
      return {
        verdict: candidatePath.endsWith('candidate-001.png') ? 'ACCEPT' : 'REPAIR',
        evaluator: { evaluatorId: 'evaluator:test' },
      };
    },
  };

  const result = await new CandidateBatchRunner().run({
    workbench,
    documentId: 'document:batch',
    intent,
    assets,
    provider,
    evaluator,
    workingDir: pack.directory,
    thresholds: { thresholdSetId: 'thresholds:test' },
  });

  assert.equal(result.candidates.length, 2);
  assert.equal(new Set(result.candidates.map(item => item.execution.seed)).size, 2);
  assert.equal(workbench.getCurrentVersion('document:batch').versionId, sourceVersion.versionId);
  assert.equal(result.sourceHashBefore, result.sourceHashAfter);
  assert.deepEqual(
    result.candidates.map(item => item.evaluation.verdict),
    ['ACCEPT', 'REPAIR'],
  );
});
