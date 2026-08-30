import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bindReferenceRoles } from '../../src/character-remaster/contracts.js';
import { CandidateBatchRunner } from '../../src/character-remaster/candidate-batch-runner.js';
import { sanitizeRealMvpEvidence, classifyRealMvpEvidence } from '../../src/character-remaster/evidence.js';
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
  if (config.sourceKind !== 'rights_clear_real') {
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
