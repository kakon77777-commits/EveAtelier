import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildGenerationRequest, validateCharacterRemasterIntent } from './contracts.js';

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parameterDigest(request) {
  return createHash('sha256').update(JSON.stringify({
    operatorId: request.operatorId,
    intentText: request.intentText,
    constraints: request.constraints,
    seed: request.seed,
    sourceHash: request.source.sha256,
    references: request.references.map(reference => ({
      role: reference.role,
      sha256: reference.sha256,
    })),
  })).digest('hex');
}

function providerResultIsComplete(result, outputPath) {
  return result
    && result.status === 'completed'
    && typeof result.executionId === 'string' && result.executionId.length > 0
    && typeof result.providerId === 'string' && result.providerId.length > 0
    && typeof result.providerVersion === 'string' && result.providerVersion.length > 0
    && result.modelIdentity && typeof result.modelIdentity === 'object'
    && result.outputPath === outputPath;
}

export class CandidateBatchRunner {
  async run({
    workbench,
    documentId,
    intent,
    assets,
    provider,
    evaluator,
    workingDir,
    thresholds,
  }) {
    const validation = validateCharacterRemasterIntent(intent);
    if (!validation.ok) throw new Error(validation.reason);
    if (!provider || typeof provider.generateVariation !== 'function') {
      throw new TypeError('generation_provider_required');
    }
    if (!evaluator || typeof evaluator.evaluate !== 'function') {
      throw new TypeError('character_evaluator_required');
    }

    await mkdir(workingDir, { recursive: true });
    const sourceVersion = workbench.getCurrentVersion(documentId);
    if (sourceVersion.assetHash !== assets.source.sha256) throw new Error('source_asset_identity_mismatch');
    const sourceHashBefore = hashFile(sourceVersion.assetPath);
    const candidates = [];

    for (let index = 0; index < intent.constraints.candidateCount; index += 1) {
      const outputPath = join(workingDir, `candidate-${String(index + 1).padStart(3, '0')}.png`);
      const request = buildGenerationRequest({ intent, assets, candidateIndex: index, outputPath });
      const startedAt = new Date().toISOString();
      const generated = await provider.generateVariation(request);
      const finishedAt = new Date().toISOString();
      if (!providerResultIsComplete(generated, outputPath)) {
        throw new Error(generated?.outputPath !== outputPath
          ? 'provider_output_path_mismatch'
          : 'generation_provider_result_invalid');
      }

      const execution = {
        executionId: generated.executionId,
        operationId: request.operationId,
        operatorId: request.operatorId,
        providerId: generated.providerId,
        providerVersion: generated.providerVersion,
        inputRefs: [request.source.path, ...request.references.map(reference => reference.path)],
        outputRefs: [outputPath],
        startedAt: generated.startedAt ?? startedAt,
        finishedAt: generated.finishedAt ?? finishedAt,
        status: 'completed',
        reproducibility: 'seeded_stochastic',
        seed: request.seed,
        mode: generated.mode ?? 'real',
        modelIdentity: structuredClone(generated.modelIdentity),
        parameterDigest: generated.parameterDigest ?? parameterDigest(request),
        evidence: structuredClone(generated.evidence ?? {}),
      };
      const staged = workbench.stageCandidate({
        documentId,
        parentVersionId: sourceVersion.versionId,
        assetPath: outputPath,
        execution,
        evaluation: { verdict: 'UNVERIFIED', evidence: { reason: 'independent_evaluation_pending' } },
      });
      const evaluation = await evaluator.evaluate({
        sourcePath: sourceVersion.assetPath,
        candidatePath: outputPath,
        references: assets.references,
        thresholds,
      });
      workbench.recordEvaluation({ documentId, versionId: staged.versionId, evaluation });
      candidates.push(workbench.getVersion(documentId, staged.versionId));
    }

    const sourceHashAfter = hashFile(sourceVersion.assetPath);
    if (sourceHashBefore !== sourceHashAfter) throw new Error('source_asset_mutated');
    return { candidates, sourceHashBefore, sourceHashAfter };
  }
}
