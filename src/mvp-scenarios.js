import { join } from 'node:path';
import { validateBackgroundRemoval, validateRelight, inspectRaster } from './evaluation.js';

function receipt({ operationId, operatorId, provider, inputRefs, outputRefs, status = 'completed', evidence = {} }) {
  const now = new Date().toISOString();
  return {
    executionId: `exec:${operationId}`,
    operationId,
    operatorId,
    providerId: provider.providerId,
    providerVersion: provider.providerVersion ?? 'unknown',
    inputRefs,
    outputRefs,
    startedAt: now,
    finishedAt: now,
    status,
    reproducibility: 'best_effort',
    evidence,
  };
}

export async function runBackgroundRemovalScenario({ workbench, provider, documentId, workingDir }) {
  const sourceVersion = workbench.getCurrentVersion(documentId);
  const mask = join(workingDir, 'mvp-mask.png');
  const alpha = join(workingDir, 'mvp-alpha.png');
  const clean = join(workingDir, 'mvp-clean.png');

  await provider.execute({ operatorId: 'visual.op.raster.create_mask', input: sourceVersion.assetPath, output: mask, params: { background: [255, 255, 255], tolerance: 8 } });
  await provider.execute({ operatorId: 'visual.op.raster.create_alpha', input: sourceVersion.assetPath, output: alpha, params: { mask } });
  const finalStep = await provider.execute({ operatorId: 'visual.op.raster.edge_cleanup', input: alpha, output: clean, params: { radius: 1 } });
  const validation = validateBackgroundRemoval(clean);
  const execution = receipt({
    operationId: 'mvp:bg-remove',
    operatorId: 'visual.op.raster.edge_cleanup',
    provider,
    inputRefs: [sourceVersion.assetPath],
    outputRefs: [clean],
    evidence: { pipeline: ['create_mask', 'create_alpha', 'edge_cleanup'], providerMetadata: finalStep.metadata },
  });
  const candidate = workbench.stageCandidate({
    documentId,
    parentVersionId: sourceVersion.versionId,
    assetPath: clean,
    execution,
    evaluation: { verdict: validation.verdict, evidence: validation },
  });
  let promoted = false;
  if (validation.verdict === 'ACCEPT') {
    workbench.promoteCandidate({ documentId, versionId: candidate.versionId, approvedBy: 'validator:auto' });
    promoted = true;
  }
  return { verdict: validation.verdict, promoted, candidateVersionId: candidate.versionId, validation, execution };
}

export async function runIdentityPreservingRelightScenario({ workbench, provider, documentId, workingDir }) {
  const sourceVersion = workbench.getCurrentVersion(documentId);
  const normal = join(workingDir, 'mvp-normal.png');
  const relit = join(workingDir, 'mvp-relit.png');
  await provider.execute({ operatorId: 'visual.op.physical.infer_normal', input: sourceVersion.assetPath, output: normal, params: { strength: 2 } });
  const finalStep = await provider.execute({
    operatorId: 'visual.op.physical.relight',
    input: sourceVersion.assetPath,
    output: relit,
    params: {
      normal,
      keyDirection: [-0.6, -0.4, 1],
      keyColor: [0.65, 0.78, 1.0],
      keyIntensity: 0.9,
      fillColor: [1.0, 0.55, 0.35],
      fillIntensity: 0.25,
      ambient: 0.25,
    },
  });
  const validation = validateRelight(sourceVersion.assetPath, relit);
  const execution = receipt({
    operationId: 'mvp:relight',
    operatorId: 'visual.op.physical.relight',
    provider,
    inputRefs: [sourceVersion.assetPath, normal],
    outputRefs: [relit],
    evidence: { providerMetadata: finalStep.metadata, approximation: 'ofp_lite' },
  });
  const candidate = workbench.stageCandidate({
    documentId,
    parentVersionId: sourceVersion.versionId,
    assetPath: relit,
    execution,
    evaluation: { verdict: validation.verdict, evidence: validation },
  });
  let promoted = false;
  if (validation.verdict === 'ACCEPT') {
    workbench.promoteCandidate({ documentId, versionId: candidate.versionId, approvedBy: 'validator:auto' });
    promoted = true;
  }
  return { verdict: validation.verdict, promoted, candidateVersionId: candidate.versionId, validation, execution };
}

export async function runCharacterRemasterFixtureScenario({ workbench, provider, documentId, workingDir, prompt }) {
  const sourceVersion = workbench.getCurrentVersion(documentId);
  const output = join(workingDir, 'mvp-character-candidate.png');
  const generation = await provider.generate({ prompt, output, width: 64, height: 64, seed: 7 });
  const inspection = inspectRaster(output);
  const execution = receipt({
    operationId: 'mvp:character-remaster-fixture',
    operatorId: 'visual.op.generative.generate',
    provider,
    inputRefs: [sourceVersion.assetPath],
    outputRefs: [output],
    evidence: { generationMode: generation.mode, inspection },
  });
  const evaluation = {
    verdict: 'UNVERIFIED',
    evidence: {
      reason: 'real_identity_evaluator_and_real_generation_provider_unavailable',
      generationMode: generation.mode,
      inspection,
    },
  };
  const candidate = workbench.stageCandidate({
    documentId,
    parentVersionId: sourceVersion.versionId,
    assetPath: output,
    execution,
    evaluation,
  });
  return {
    executionMode: generation.mode,
    verdict: evaluation.verdict,
    promoted: false,
    candidateVersionId: candidate.versionId,
    validation: evaluation.evidence,
    execution,
  };
}
