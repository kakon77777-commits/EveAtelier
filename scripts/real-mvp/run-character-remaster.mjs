import { createHash } from 'node:crypto';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bindReferenceRoles } from '../../src/character-remaster/contracts.js';
import { CandidateBatchRunner } from '../../src/character-remaster/candidate-batch-runner.js';
import { sanitizeRealMvpEvidence, classifyRealMvpEvidence } from '../../src/character-remaster/evidence.js';
import {
  LocalizedRepairRunner,
  localizedRepairThresholdsStatus,
} from '../../src/character-remaster/localized-repair.js';
import { PythonCharacterRemasterEvaluator } from '../../src/character-remaster/python-evaluator.js';
import { ComfyUiProvider } from '../../src/providers/comfyui-provider.js';
import { DiffusersProvider } from '../../src/providers/diffusers-provider.js';
import { EveAtelierWorkbench } from '../../src/workbench.js';
import { MrmicClient, buildArtResourcePortal } from '../../src/mrmic-client.js';

export function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new Error('real_mvp_command_required');
  const parsed = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error('real_mvp_argument_invalid');
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

export function validateExecutionGate({
  command,
  env,
  config,
  thresholds,
  review,
  candidateVersionIds = [],
}) {
  if (env?.EVE_REAL_MVP !== '1') throw new Error('real_mvp_opt_in_required');
  if (!config || !['comfyui', 'diffusers'].includes(config.provider?.type)) {
    if (config?.provider?.type === 'fixture') throw new Error('fixture_provider_forbidden_for_real_run');
    throw new Error('real_generation_provider_configuration_required');
  }
  if (config.sourceKind === 'private_research_authorized') {
    if (env?.EVE_PRIVATE_RESEARCH_APPROVED !== '1') {
      throw new Error('private_research_opt_in_required');
    }
  } else if (config.sourceKind !== 'rights_clear_real') {
    throw new Error('rights_clear_source_reference_pack_required');
  }
  if (!config.evaluator?.model?.modelId) throw new Error('real_evaluator_model_required');
  if (thresholds?.calibrationStatus !== 'CALIBRATED'
      || typeof thresholds?.calibrationFixtureSet !== 'string'
      || thresholds.calibrationFixtureSet.length === 0) {
    throw new Error('calibrated_thresholds_required');
  }
  const downloadRequested = config.provider?.model?.allowDownload === true
    || config.evaluator?.model?.allowDownload === true;
  if (downloadRequested && env?.EVE_MODEL_DOWNLOAD_APPROVED !== '1') {
    throw new Error('model_download_approval_required');
  }
  if (command === 'review-promote-project') {
    if (!review || typeof review !== 'object') throw new Error('human_review_file_required');
    if (!candidateVersionIds.includes(review.candidateVersionId)) {
      throw new Error('human_review_candidate_mismatch');
    }
  }
}

export function validateLocalizedRepairConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('localized_repair_config_required');
  }
  if (typeof value.taskId !== 'string' || value.taskId.length === 0) {
    throw new TypeError('localized_repair_task_id_required');
  }
  if (!Number.isInteger(value.candidateCount) || value.candidateCount < 2 || value.candidateCount > 4) {
    throw new RangeError('localized_repair_candidate_count_must_be_2_to_4');
  }
  if (!Number.isSafeInteger(value.baseSeed) || value.baseSeed < 0) {
    throw new RangeError('localized_repair_base_seed_invalid');
  }
  if (!Array.isArray(value.intentText)
      || value.intentText.length === 0
      || value.intentText.some(line => typeof line !== 'string' || line.trim().length === 0)) {
    throw new TypeError('localized_repair_intent_required');
  }
  if (!value.mask || typeof value.mask !== 'object') throw new TypeError('localized_repair_mask_required');
  if (!Number.isInteger(value.mask.width) || value.mask.width <= 0
      || !Number.isInteger(value.mask.height) || value.mask.height <= 0) {
    throw new RangeError('localized_repair_mask_dimensions_invalid');
  }
  if (!Array.isArray(value.mask.regions) || value.mask.regions.length === 0) {
    throw new TypeError('localized_repair_regions_required');
  }
  const thresholdStatus = localizedRepairThresholdsStatus(value.localityThresholds);
  if (thresholdStatus === 'missing') {
    throw new TypeError('localized_repair_thresholds_required');
  }
  if (thresholdStatus === 'invalid') throw new TypeError('localized_repair_thresholds_invalid');
  return structuredClone(value);
}

export function localizedRepairWorkflowDigest(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  const workflow = JSON.parse(text);
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error('localized_repair_workflow_invalid');
  }
  return createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
}

export function validateLocalizedRepairExecutionGate({ config, repair, workflowSha256 }) {
  const provider = config?.provider;
  if (provider?.type !== 'comfyui') throw new Error('localized_repair_comfyui_required');
  if (provider.model?.allowDownload === true) throw new Error('localized_repair_model_download_forbidden');
  if (!provider.bindings?.maskImage
      || typeof provider.bindings.maskImage.nodeId !== 'string'
      || typeof provider.bindings.maskImage.input !== 'string') {
    throw new Error('localized_repair_mask_binding_required');
  }
  if (typeof provider.outputNodeId !== 'string' || provider.outputNodeId.length === 0) {
    throw new Error('localized_repair_output_node_required');
  }
  const model = provider.model;
  if (!model
      || ['id', 'revision', 'file', 'sha256'].some(key => typeof model[key] !== 'string' || !model[key])
      || !/^[a-f0-9]{64}$/i.test(model.sha256)) {
    throw new Error('localized_repair_model_identity_required');
  }
  if (typeof repair?.workflowSha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(repair.workflowSha256)) {
    throw new Error('localized_repair_workflow_hash_required');
  }
  if (workflowSha256 !== repair.workflowSha256) {
    throw new Error('localized_repair_workflow_hash_mismatch');
  }
}

export function validateLocalizedRepairWorkbench(workbench, documentId) {
  const document = workbench.getDocument(documentId);
  if (document.promotionPolicy !== 'human_required') {
    throw new Error('localized_repair_human_policy_required');
  }
  return document;
}

export function validateLocalizedRepairMaskPreflight({
  repair,
  maskEvidence,
  actualMaskSha256,
  parentLocality,
}) {
  if (!maskEvidence
      || maskEvidence.width !== repair?.mask?.width
      || maskEvidence.height !== repair?.mask?.height
      || parentLocality?.sameDimensions !== true
      || parentLocality.totalPixels !== repair.mask.width * repair.mask.height) {
    throw new Error('localized_repair_mask_dimensions_mismatch');
  }
  if (!Number.isInteger(maskEvidence.nonZeroPixels)
      || maskEvidence.nonZeroPixels <= 0
      || parentLocality.maskPixels !== maskEvidence.nonZeroPixels
      || !Number.isFinite(maskEvidence.maskCoverage)
      || maskEvidence.maskCoverage <= 0) {
    throw new Error('localized_repair_mask_empty');
  }
  if (maskEvidence.maskCoverage > repair.localityThresholds.maxMaskCoverage) {
    throw new Error('localized_repair_scope_too_large');
  }
  if (maskEvidence.sha256 !== actualMaskSha256) {
    throw new Error('localized_repair_mask_hash_mismatch');
  }
  if (Math.abs(parentLocality.maskCoverage - maskEvidence.maskCoverage) > 1e-12) {
    throw new Error('localized_repair_mask_evidence_mismatch');
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relativeTo(base, path) {
  return isAbsolute(path) ? path : resolve(base, path);
}

async function loadInputs(configPath) {
  const absoluteConfigPath = resolve(configPath);
  const configDirectory = dirname(absoluteConfigPath);
  const config = await readJson(absoluteConfigPath);
  const intentPath = relativeTo(configDirectory, config.intentPath);
  const thresholdsPath = relativeTo(configDirectory, config.thresholdsPath);
  const intent = await readJson(intentPath);
  const thresholds = await readJson(thresholdsPath);
  const fixtureRoot = config.fixtureRoot
    ? relativeTo(configDirectory, config.fixtureRoot)
    : resolve(dirname(intentPath), '..');
  const sourceAsset = relativeTo(fixtureRoot, intent.sourceAsset);
  const references = intent.references.map(reference => ({
    ...reference,
    path: relativeTo(fixtureRoot, reference.path),
  }));
  return {
    config,
    configDirectory,
    intent,
    thresholds,
    assets: bindReferenceRoles({ sourceAsset, references }),
  };
}

async function generationProvider(config, configDirectory, env) {
  if (config.provider.type === 'comfyui') {
    const workflowPath = relativeTo(configDirectory, config.provider.workflowPath);
    return new ComfyUiProvider({
      baseUrl: env.EVE_COMFYUI_URL ?? config.provider.baseUrl,
      timeoutMs: config.provider.timeoutMs ?? 5000,
      workflow: await readJson(workflowPath),
      bindings: config.provider.bindings,
      outputNodeId: config.provider.outputNodeId,
      modelIdentity: config.provider.model,
      clientId: config.provider.clientId ?? 'eve-real-mvp',
      pollIntervalMs: config.provider.pollIntervalMs ?? 500,
      maxWaitMs: config.provider.maxWaitMs ?? 600_000,
    });
  }
  return new DiffusersProvider({ python: config.python ?? 'python3', model: config.provider.model });
}

function runtimeDirectory(config, configDirectory, taskId) {
  return config.runtimeDir
    ? relativeTo(configDirectory, config.runtimeDir)
    : resolve('artifacts', 'runtime', 'real-mvp', taskId);
}

async function generateEvaluate({ configPath, env }) {
  const inputs = await loadInputs(configPath);
  validateExecutionGate({
    command: 'generate-evaluate',
    env,
    config: inputs.config,
    thresholds: inputs.thresholds,
  });
  const provider = await generationProvider(inputs.config, inputs.configDirectory, env);
  const evaluator = new PythonCharacterRemasterEvaluator({
    python: inputs.config.python ?? 'python3',
    model: inputs.config.evaluator.model,
  });
  const providerProbe = inputs.config.provider.type === 'comfyui'
    ? await provider.probe({ includeObjectInfo: true })
    : await provider.probe();
  if (providerProbe.available !== true) {
    throw new Error(`generation_provider_unavailable:${providerProbe.reason ?? 'unknown'}`);
  }
  const evaluatorProbe = await evaluator.probe();
  if (evaluatorProbe.available !== true) {
    throw new Error(`character_evaluator_unavailable:${evaluatorProbe.reason ?? 'unknown'}`);
  }

  const workbench = new EveAtelierWorkbench({ projectId: inputs.config.projectId });
  workbench.createDocument({
    documentId: inputs.config.documentId,
    sourceAsset: inputs.assets.source.path,
    promotionPolicy: 'human_required',
  });
  const outputDirectory = runtimeDirectory(inputs.config, inputs.configDirectory, inputs.intent.taskId);
  const batch = await new CandidateBatchRunner().run({
    workbench,
    documentId: inputs.config.documentId,
    intent: inputs.intent,
    assets: inputs.assets,
    provider,
    evaluator,
    workingDir: join(outputDirectory, 'candidates'),
    thresholds: inputs.thresholds,
  });
  const statePath = join(outputDirectory, 'workbench-state.json');
  const reviewPath = join(outputDirectory, 'human-review.json');
  const evidencePath = join(outputDirectory, 'generation-evaluation-evidence.json');
  await writeJson(statePath, workbench.exportState());
  await writeJson(reviewPath, {
    reviewId: `${inputs.intent.taskId}:review`,
    candidateVersionId: null,
    reviewer: { kind: 'human', id: null },
    disposition: null,
    reason: '',
    reviewedAt: null,
    evidenceClass: 'human_observed',
    candidateChoices: batch.candidates.map(candidate => ({
      versionId: candidate.versionId,
      artifactHash: candidate.assetHash,
      verdict: candidate.evaluation.verdict,
    })),
  });
  const accepted = batch.candidates.find(candidate => ['ACCEPT', 'ACCEPT_WITH_WARNINGS'].includes(candidate.evaluation.verdict));
  const rawEvidence = {
    schema: 'eve-atelier-real-mvp-evidence/v1',
    taskId: inputs.intent.taskId,
    generation: {
      attempted: true,
      status: 'completed',
      mode: batch.candidates.every(candidate => candidate.execution.mode === 'real') ? 'real' : 'fixture',
      sourceKind: inputs.config.sourceKind,
      candidateCount: batch.candidates.length,
      artifactHashes: batch.candidates.map(candidate => candidate.assetHash),
      providerProbe,
    },
    evaluation: {
      status: 'completed',
      mode: 'real',
      evaluatorId: evaluatorProbe.evaluatorId,
      modelId: evaluatorProbe.modelId,
      calibrationStatus: inputs.thresholds.calibrationStatus,
      acceptedCandidateId: accepted?.versionId ?? null,
      candidates: batch.candidates.map(candidate => ({
        versionId: candidate.versionId,
        artifactHash: candidate.assetHash,
        evaluation: candidate.evaluation,
      })),
    },
    humanReview: null,
    promotion: { success: false },
    mrmic: { live: false },
    verification: null,
  };
  const sanitized = sanitizeRealMvpEvidence(rawEvidence);
  await writeJson(evidencePath, { ...sanitized, classification: classifyRealMvpEvidence(sanitized) });
  return { statePath, reviewPath, evidencePath, classification: classifyRealMvpEvidence(sanitized) };
}

export async function localizedRepairGenerateEvaluate({
  configPath,
  statePath,
  env,
  provider: providedProvider,
  evaluator: providedEvaluator,
}) {
  const inputs = await loadInputs(configPath);
  const repair = validateLocalizedRepairConfig(inputs.config.localizedRepair);
  const workflowPath = relativeTo(inputs.configDirectory, inputs.config.provider?.workflowPath ?? '');
  const workflowSha256 = inputs.config.provider?.type === 'comfyui'
    ? localizedRepairWorkflowDigest(await readFile(workflowPath))
    : null;
  validateLocalizedRepairExecutionGate({
    config: inputs.config,
    repair,
    workflowSha256,
  });
  validateExecutionGate({
    command: 'generate-evaluate',
    env,
    config: inputs.config,
    thresholds: inputs.thresholds,
  });
  const state = await readJson(resolve(statePath));
  const workbench = EveAtelierWorkbench.fromState(state);
  validateLocalizedRepairWorkbench(workbench, inputs.config.documentId);
  const parent = workbench.getCurrentVersion(inputs.config.documentId);
  const provider = providedProvider
    ?? await generationProvider(inputs.config, inputs.configDirectory, env);
  const evaluator = providedEvaluator ?? new PythonCharacterRemasterEvaluator({
    python: inputs.config.python ?? 'python3',
    model: inputs.config.evaluator.model,
  });
  const providerProbe = inputs.config.provider.type === 'comfyui'
    ? await provider.probe({ includeObjectInfo: true })
    : await provider.probe();
  if (providerProbe.available !== true) {
    throw new Error(`generation_provider_unavailable:${providerProbe.reason ?? 'unknown'}`);
  }
  const evaluatorProbe = await evaluator.probe();
  if (evaluatorProbe.available !== true) {
    throw new Error(`character_evaluator_unavailable:${evaluatorProbe.reason ?? 'unknown'}`);
  }

  const outputDirectory = runtimeDirectory(inputs.config, inputs.configDirectory, repair.taskId);
  let outputExists = false;
  try {
    await stat(outputDirectory);
    outputExists = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (outputExists) throw new Error('localized_repair_output_exists');
  await mkdir(outputDirectory, { recursive: true });
  const maskPath = join(outputDirectory, 'repair-mask.png');
  const maskEvidence = await evaluator.buildLocalizedRepairMask({
    ...repair.mask,
    outputPath: maskPath,
  });
  const actualMaskSha256 = createHash('sha256').update(await readFile(maskPath)).digest('hex');
  const parentLocality = await evaluator.evaluateLocalizedRepair({
    parentPath: parent.assetPath,
    candidatePath: parent.assetPath,
    maskPath,
  });
  validateLocalizedRepairMaskPreflight({
    repair,
    maskEvidence,
    actualMaskSha256,
    parentLocality,
  });
  const batch = await new LocalizedRepairRunner().run({
    workbench,
    documentId: inputs.config.documentId,
    parentVersionId: parent.versionId,
    identitySourcePath: inputs.assets.source.path,
    maskPath,
    references: inputs.assets.references,
    provider,
    evaluator,
    workingDir: join(outputDirectory, 'candidates'),
    taskId: repair.taskId,
    intentText: repair.intentText,
    negativePrompt: repair.negativePrompt ?? '',
    candidateCount: repair.candidateCount,
    baseSeed: repair.baseSeed,
    globalThresholds: inputs.thresholds,
    localityThresholds: repair.localityThresholds,
  });
  const outputStatePath = join(outputDirectory, 'workbench-state.json');
  const reviewPath = join(outputDirectory, 'human-review.json');
  const evidencePath = join(outputDirectory, 'generation-evaluation-evidence.json');
  await writeJson(outputStatePath, workbench.exportState());
  await writeJson(reviewPath, {
    reviewId: `${repair.taskId}:review`,
    candidateVersionId: null,
    reviewer: { kind: 'human', id: null },
    disposition: null,
    reason: '',
    reviewedAt: null,
    evidenceClass: 'human_observed',
    repairParentVersionId: parent.versionId,
    candidateChoices: batch.candidates.map(candidate => ({
      versionId: candidate.versionId,
      artifactHash: candidate.assetHash,
      verdict: candidate.evaluation.verdict,
      locality: candidate.evaluation.locality,
    })),
  });
  const accepted = batch.candidates.find(candidate => (
    ['ACCEPT', 'ACCEPT_WITH_WARNINGS'].includes(candidate.evaluation.verdict)
  ));
  const rawEvidence = {
    schema: 'eve-atelier-localized-repair-evidence/v1',
    taskId: repair.taskId,
    generation: {
      attempted: true,
      status: 'completed',
      mode: batch.candidates.every(candidate => candidate.execution.mode === 'real') ? 'real' : 'fixture',
      sourceKind: inputs.config.sourceKind,
      candidateCount: batch.candidates.length,
      artifactHashes: batch.candidates.map(candidate => candidate.assetHash),
      providerProbe,
    },
    evaluation: {
      status: 'completed',
      mode: 'real',
      evaluatorId: evaluatorProbe.evaluatorId,
      modelId: evaluatorProbe.modelId,
      calibrationStatus: inputs.thresholds.calibrationStatus,
      acceptedCandidateId: accepted?.versionId ?? null,
      candidates: batch.candidates.map(candidate => ({
        versionId: candidate.versionId,
        artifactHash: candidate.assetHash,
        evaluation: candidate.evaluation,
      })),
    },
    repair: {
      parentVersionId: parent.versionId,
      parentArtifactHash: parent.assetHash,
      mask: {
        width: maskEvidence.width,
        height: maskEvidence.height,
        nonZeroPixels: maskEvidence.nonZeroPixels,
        maskCoverage: maskEvidence.maskCoverage,
        sha256: batch.maskHashBefore,
      },
      localityThresholds: repair.localityThresholds,
      protectedParentHashPreserved: batch.parentHashBefore === batch.parentHashAfter,
      identitySourceHashPreserved: batch.identitySourceHashBefore === batch.identitySourceHashAfter,
      maskHashPreserved: batch.maskHashBefore === batch.maskHashAfter,
    },
    humanReview: null,
    promotion: { success: false },
    mrmic: { live: false },
    verification: null,
  };
  const sanitized = sanitizeRealMvpEvidence(rawEvidence);
  await writeJson(evidencePath, {
    ...sanitized,
    classification: classifyRealMvpEvidence(sanitized),
  });
  return {
    statePath: outputStatePath,
    reviewPath,
    evidencePath,
    classification: classifyRealMvpEvidence(sanitized),
  };
}

async function reviewPromoteProject({ configPath, statePath, reviewPath, env }) {
  const inputs = await loadInputs(configPath);
  const state = await readJson(resolve(statePath));
  const review = await readJson(resolve(reviewPath));
  const candidateVersionIds = state.documents.flatMap(document => document.versions)
    .filter(version => version.status === 'candidate')
    .map(version => version.versionId);
  validateExecutionGate({
    command: 'review-promote-project',
    env,
    config: inputs.config,
    thresholds: inputs.thresholds,
    review,
    candidateVersionIds,
  });
  const workbench = EveAtelierWorkbench.fromState(state);
  workbench.recordHumanReview({
    documentId: inputs.config.documentId,
    versionId: review.candidateVersionId,
    review,
  });
  const candidate = workbench.getVersion(inputs.config.documentId, review.candidateVersionId);
  const mrmic = new MrmicClient({
    baseUrl: env.EVE_MRMIC_URL ?? inputs.config.mrmic.baseUrl,
    timeoutMs: inputs.config.mrmic.timeoutMs ?? 5000,
  });
  const capabilities = await mrmic.probeCapabilities();
  const initial = await mrmic.getState();
  const actor = inputs.config.mrmic.actor ?? { actorType: 'user', actorId: 'eve-atelier-local-owner' };
  const portalId = `portal:eve-atelier:${inputs.intent.taskId}`;
  const candidateResourceId = `artasset://eve-atelier/${inputs.intent.taskId}/${candidate.versionId}/candidate?sha256=${candidate.assetHash}`;
  const portal = buildArtResourcePortal({
    id: portalId,
    canvasId: initial.canvas.id,
    workspaceId: initial.workspace.id,
    providerResourceId: candidateResourceId,
    createdBy: actor,
    revision: 0,
    transform: inputs.config.mrmic.transform,
  });
  await mrmic.projectPortal({
    portal,
    expectedCanvasRevision: initial.canvas.revision,
    actor,
    bearerToken: env.EVE_MRMIC_TOKEN,
    idempotencyKey: `eve:create:${inputs.intent.taskId}`,
  });
  const promoted = workbench.promoteCandidate({
    documentId: inputs.config.documentId,
    versionId: review.candidateVersionId,
  });
  const afterCandidate = await mrmic.getState();
  const promotedResourceId = `artasset://eve-atelier/${inputs.intent.taskId}/${promoted.versionId}/promoted?sha256=${promoted.assetHash}`;
  await mrmic.patchPortal({
    canvasId: initial.canvas.id,
    portalId,
    providerResourceId: promotedResourceId,
    expectedCanvasRevision: afterCandidate.canvas.revision,
    actor,
    bearerToken: env.EVE_MRMIC_TOKEN,
    idempotencyKey: `eve:promote:${inputs.intent.taskId}`,
  });
  const render = await fetch(`${(env.EVE_MRMIC_URL ?? inputs.config.mrmic.baseUrl).replace(/\/$/, '')}/api/render.svg`, {
    signal: AbortSignal.timeout(inputs.config.mrmic.timeoutMs ?? 5000),
  });
  const svg = await render.text();
  const rendered = render.ok && svg.includes(portalId) && svg.includes(promotedResourceId);
  const outputDirectory = runtimeDirectory(inputs.config, inputs.configDirectory, inputs.intent.taskId);
  const priorEvidence = await readJson(join(outputDirectory, 'generation-evaluation-evidence.json'));
  const evidence = {
    ...priorEvidence,
    humanReview: sanitizeRealMvpEvidence(review),
    promotion: { success: true, currentVersionId: promoted.versionId, artifactHash: promoted.assetHash },
    mrmic: {
      live: true,
      evidenceClass: 'live_local_integration',
      authMode: env.EVE_MRMIC_TOKEN ? 'bearer_principal_v1' : 'legacy_local',
      capabilitySchema: capabilities.schema,
      candidateVerified: true,
      promotedVerified: true,
      rendered,
      ownershipTransferred: false,
      portalId,
      providerResourceId: promotedResourceId,
    },
  };
  delete evidence.classification;
  evidence.classification = classifyRealMvpEvidence(evidence);
  await writeJson(join(outputDirectory, 'workbench-state-promoted.json'), workbench.exportState());
  await writeJson(join(outputDirectory, 'final-evidence.json'), sanitizeRealMvpEvidence(evidence));
  return evidence.classification;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseCliArgs(argv);
  if (!args.config) throw new Error('real_mvp_config_required');
  if (args.command === 'generate-evaluate') {
    return generateEvaluate({ configPath: args.config, env });
  }
  if (args.command === 'localized-repair-generate-evaluate') {
    if (!args.state) throw new Error('localized_repair_state_required');
    return localizedRepairGenerateEvaluate({
      configPath: args.config,
      statePath: args.state,
      env,
    });
  }
  if (args.command === 'review-promote-project') {
    if (!args.state || !args.review) throw new Error('state_and_review_paths_required');
    return reviewPromoteProject({
      configPath: args.config,
      statePath: args.state,
      reviewPath: args.review,
      env,
    });
  }
  throw new Error(`unsupported_real_mvp_command:${args.command}`);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  main().then(
    result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    error => {
      process.stderr.write(`error:${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
