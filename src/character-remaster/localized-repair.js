import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

function fileIdentity(path) {
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`localized_repair_input_not_file:${path}`);
  return {
    path,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    bytes: stats.size,
  };
}

function requestDigest(request) {
  return createHash('sha256').update(JSON.stringify({
    operatorId: request.operatorId,
    parentHash: request.source.sha256,
    maskHash: request.mask.sha256,
    references: request.references.map(item => ({ role: item.role, sha256: item.sha256 })),
    intentText: request.intentText,
    negativePrompt: request.negativePrompt,
    seed: request.seed,
  })).digest('hex');
}

function localityEvidenceValid(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.sameDimensions !== 'boolean') return false;
  if (!Number.isInteger(value.totalPixels) || value.totalPixels <= 0) return false;
  if (!Number.isInteger(value.maskPixels)
      || value.maskPixels <= 0
      || value.maskPixels > value.totalPixels) return false;
  if (!Number.isFinite(value.maskCoverage)
      || value.maskCoverage <= 0
      || value.maskCoverage > 1
      || Math.abs(value.maskCoverage - (value.maskPixels / value.totalPixels)) > 1e-12) return false;
  if (!Number.isInteger(value.insideChangedPixels)
      || value.insideChangedPixels < 0
      || value.insideChangedPixels > value.maskPixels) return false;
  if (!Number.isInteger(value.outsideChangedPixels)
      || value.outsideChangedPixels < 0
      || value.outsideChangedPixels > value.totalPixels - value.maskPixels) return false;
  if (!Number.isInteger(value.outsideMaxAbsoluteDelta)
      || value.outsideMaxAbsoluteDelta < 0
      || value.outsideMaxAbsoluteDelta > 255) return false;
  return true;
}

export function localizedRepairThresholdsStatus(value) {
  const required = [
    'maxMaskCoverage',
    'minInsideChangedPixels',
    'maxOutsideChangedPixels',
    'maxOutsideAbsoluteDelta',
  ];
  if (!value || typeof value !== 'object' || required.some(key => !Number.isFinite(value[key]))) {
    return 'missing';
  }
  if (value.maxMaskCoverage <= 0
      || value.maxMaskCoverage > 1
      || !Number.isInteger(value.minInsideChangedPixels)
      || value.minInsideChangedPixels <= 0
      || value.maxOutsideChangedPixels !== 0
      || value.maxOutsideAbsoluteDelta !== 0) {
    return 'invalid';
  }
  return 'valid';
}

export function decideLocalizedRepairVerdict({ globalEvaluation, locality, thresholds } = {}) {
  const thresholdStatus = localizedRepairThresholdsStatus(thresholds);
  const globalVerdicts = new Set(['ACCEPT', 'ACCEPT_WITH_WARNINGS', 'REPAIR', 'REJECT', 'UNVERIFIED']);
  const globalEvaluationPresent = globalVerdicts.has(globalEvaluation?.verdict);
  const outsideChanged = locality?.outsideChangedPixels > thresholds?.maxOutsideChangedPixels
    || locality?.outsideMaxAbsoluteDelta > thresholds?.maxOutsideAbsoluteDelta;
  const noEffect = locality?.insideChangedPixels < thresholds?.minInsideChangedPixels;
  const invalidScope = locality?.maskCoverage > thresholds?.maxMaskCoverage;
  let verdict;
  let failures;
  if (thresholdStatus === 'missing') {
    verdict = 'UNVERIFIED';
    failures = ['localized_repair_thresholds_required'];
  } else if (thresholdStatus === 'invalid') {
    verdict = 'UNVERIFIED';
    failures = ['localized_repair_thresholds_invalid'];
  } else if (!localityEvidenceValid(locality)) {
    verdict = 'UNVERIFIED';
    failures = ['localized_repair_evidence_invalid'];
  } else if (!globalEvaluationPresent) {
    verdict = 'UNVERIFIED';
    failures = ['global_evaluation_required'];
  } else if (locality?.sameDimensions !== true) {
    verdict = 'REJECT';
    failures = ['localized_repair_dimensions_changed'];
  } else if (invalidScope) {
    verdict = 'REJECT';
    failures = ['localized_repair_scope_too_large'];
  } else if (globalEvaluation?.verdict === 'REJECT') {
    verdict = 'REJECT';
    failures = ['global_evaluation_rejected'];
  } else if (globalEvaluation?.verdict === 'UNVERIFIED') {
    verdict = 'UNVERIFIED';
    failures = ['global_evaluation_unverified'];
  } else if (globalEvaluation?.verdict === 'REPAIR') {
    verdict = 'REPAIR';
    failures = ['global_evaluation_requires_repair'];
  } else if (outsideChanged) {
    verdict = 'REPAIR';
    failures = ['outside_mask_changed'];
  } else if (noEffect) {
    verdict = 'REPAIR';
    failures = ['localized_repair_no_effect'];
  } else {
    verdict = globalEvaluation?.verdict === 'ACCEPT_WITH_WARNINGS'
      ? 'ACCEPT_WITH_WARNINGS'
      : 'ACCEPT';
    failures = [];
  }
  return {
    verdict,
    failures,
    warnings: [...(globalEvaluation?.warnings ?? [])],
    globalEvaluation: structuredClone(globalEvaluation),
    locality: structuredClone(locality),
    thresholds: structuredClone(thresholds),
  };
}

export class LocalizedRepairRunner {
  async run({
    workbench,
    documentId,
    parentVersionId,
    identitySourcePath,
    maskPath,
    references,
    provider,
    evaluator,
    workingDir,
    taskId,
    intentText,
    negativePrompt = '',
    candidateCount,
    baseSeed,
    globalThresholds,
    localityThresholds,
  }) {
    if (!provider || typeof provider.generateVariation !== 'function') {
      throw new TypeError('localized_repair_provider_required');
    }
    if (!evaluator
        || typeof evaluator.evaluate !== 'function'
        || typeof evaluator.evaluateLocalizedRepair !== 'function') {
      throw new TypeError('localized_repair_evaluator_required');
    }
    if (!Number.isInteger(candidateCount) || candidateCount < 2 || candidateCount > 4) {
      throw new RangeError('localized_repair_candidate_count_must_be_2_to_4');
    }
    if (!Number.isSafeInteger(baseSeed) || baseSeed < 0) {
      throw new RangeError('localized_repair_base_seed_invalid');
    }
    const current = workbench.getCurrentVersion(documentId);
    if (current.versionId !== parentVersionId) throw new Error('localized_repair_parent_not_current');
    const parent = workbench.getVersion(documentId, parentVersionId);
    const identitySource = fileIdentity(identitySourcePath);
    const mask = fileIdentity(maskPath);
    const parentHashBefore = fileIdentity(parent.assetPath).sha256;
    if (parentHashBefore !== parent.assetHash) throw new Error('localized_repair_parent_hash_mismatch');
    const identitySourceHashBefore = identitySource.sha256;
    const maskHashBefore = mask.sha256;
    await mkdir(workingDir, { recursive: true });
    const candidates = [];

    for (let index = 0; index < candidateCount; index += 1) {
      const outputPath = join(workingDir, `repair-candidate-${String(index + 1).padStart(3, '0')}.png`);
      const request = {
        operationId: `${taskId}:localized-repair:${index + 1}`,
        operatorId: 'visual.op.generative.inpaint',
        source: {
          path: parent.assetPath,
          sha256: parent.assetHash,
          bytes: statSync(parent.assetPath).size,
        },
        mask: structuredClone(mask),
        references: structuredClone(references),
        intentText: [...intentText],
        negativePrompt,
        constraints: {
          repairParentVersionId: parent.versionId,
          locality: 'explicit_mask',
        },
        seed: baseSeed + index,
        outputPath,
      };
      const startedAt = new Date().toISOString();
      const generated = await provider.generateVariation(request);
      const finishedAt = new Date().toISOString();
      if (!generated
          || generated.status !== 'completed'
          || generated.outputPath !== outputPath
          || typeof generated.executionId !== 'string'
          || typeof generated.providerId !== 'string'
          || typeof generated.providerVersion !== 'string'
          || !generated.modelIdentity) {
        throw new Error('localized_repair_provider_result_invalid');
      }
      const execution = {
        executionId: generated.executionId,
        operationId: request.operationId,
        operatorId: request.operatorId,
        providerId: generated.providerId,
        providerVersion: generated.providerVersion,
        inputRefs: [parent.assetPath, mask.path, ...references.map(item => item.path)],
        outputRefs: [outputPath],
        startedAt: generated.startedAt ?? startedAt,
        finishedAt: generated.finishedAt ?? finishedAt,
        status: 'completed',
        reproducibility: 'seeded_stochastic',
        seed: request.seed,
        mode: generated.mode ?? 'real',
        modelIdentity: structuredClone(generated.modelIdentity),
        parameterDigest: generated.parameterDigest ?? requestDigest(request),
        evidence: {
          ...(structuredClone(generated.evidence ?? {})),
          repairParentVersionId: parent.versionId,
          repairMaskSha256: mask.sha256,
        },
      };
      const staged = workbench.stageCandidate({
        documentId,
        parentVersionId: parent.versionId,
        assetPath: outputPath,
        execution,
        evaluation: { verdict: 'UNVERIFIED', evidence: { reason: 'localized_evaluation_pending' } },
      });
      const globalEvaluation = await evaluator.evaluate({
        sourcePath: identitySourcePath,
        candidatePath: outputPath,
        references,
        thresholds: globalThresholds,
      });
      const locality = await evaluator.evaluateLocalizedRepair({
        parentPath: parent.assetPath,
        candidatePath: outputPath,
        maskPath,
      });
      const evaluation = decideLocalizedRepairVerdict({
        globalEvaluation,
        locality,
        thresholds: localityThresholds,
      });
      workbench.recordEvaluation({ documentId, versionId: staged.versionId, evaluation });
      candidates.push(workbench.getVersion(documentId, staged.versionId));
    }

    const identitySourceHashAfter = fileIdentity(identitySourcePath).sha256;
    const parentHashAfter = fileIdentity(parent.assetPath).sha256;
    const maskHashAfter = fileIdentity(maskPath).sha256;
    if (identitySourceHashBefore !== identitySourceHashAfter) throw new Error('identity_source_mutated');
    if (parentHashBefore !== parentHashAfter) throw new Error('localized_repair_parent_mutated');
    if (maskHashBefore !== maskHashAfter) throw new Error('localized_repair_mask_mutated');
    return {
      candidates,
      identitySourceHashBefore,
      identitySourceHashAfter,
      parentHashBefore,
      parentHashAfter,
      maskHashBefore,
      maskHashAfter,
    };
  }
}
