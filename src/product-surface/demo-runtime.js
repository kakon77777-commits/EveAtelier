import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { AssetStore } from '../art-domain/asset-store.js';
import { ArtDocumentStore } from '../art-domain/store.js';
import { ArtTargetResolver } from '../art-domain/target-resolver.js';
import { WorkbenchExecutionBridge } from '../art-domain/workbench-runtime.js';
import { OperatorRegistryStore } from '../operator-runtime/registry-store.js';
import { SharpRasterProvider } from '../providers/sharp-raster-provider.js';
import { AADS_DECISIONS } from '../visual-intelligence/contracts.js';
import { AadsController } from '../visual-intelligence/controller.js';
import { evaluateBackgroundRemovalCandidate } from '../visual-intelligence/evaluators.js';
import { VisualIntelligenceStore } from '../visual-intelligence/session-store.js';
import { WorkbenchRabclAdapter } from '../visual-intelligence/workbench-adapter.js';
import { VisualKnowledgeStore } from '../visual-knowledge/store.js';
import { HumanWorkbenchSurface } from './service.js';

function advancingClock(start = '2026-09-13T01:00:00Z') {
  let milliseconds = Date.parse(start);
  if (!Number.isFinite(milliseconds)) throw new TypeError('demo_clock_start_invalid');
  return () => new Date(milliseconds += 1000).toISOString();
}

function sequentialIdFactory() {
  let sequence = 0;
  return kind => `${kind}:v05:${sequence += 1}`;
}

async function writeDemoSource(path, width = 96, height = 96) {
  const data = Buffer.alloc(width * height * 4, 255);
  for (let y = 14; y < height - 12; y += 1) {
    for (let x = 22; x < width - 20; x += 1) {
      const edge = Math.min(x - 22, width - 21 - x, y - 14, height - 13 - y);
      if (edge < 0 || (x < 32 && y < 30) || (x > 64 && y < 30)) continue;
      const offset = ((y * width) + x) * 4;
      data[offset] = 42 + Math.round((y / height) * 32);
      data[offset + 1] = 72 + Math.round((x / width) * 52);
      data[offset + 2] = 154 + Math.min(70, edge * 4);
      data[offset + 3] = 255;
    }
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(path);
  return path;
}

async function activatePack(operatorStore, humanActor, clock) {
  const pack = JSON.parse(await readFile(new URL(
    '../../fixtures/operator_runtime/v02-deterministic-pack.example.json',
    import.meta.url,
  ), 'utf8'));
  const registered = operatorStore.registerPack({
    pack,
    proposer: humanActor,
    registeredAt: clock(),
  });
  const packRef = {
    packId: registered.packId,
    version: registered.version,
    digest: registered.digest,
  };
  for (const [suffix, fromStatus, toStatus] of [
    ['experimental', 'DRAFT', 'EXPERIMENTAL_UNCALIBRATED'],
    ['calibrated', 'EXPERIMENTAL_UNCALIBRATED', 'CALIBRATED'],
    ['active', 'CALIBRATED', 'ACTIVE'],
  ]) {
    operatorStore.appendLifecycleEvent({
      schema: 'eve-atelier-operator-lifecycle-event/v1',
      eventId: `lifecycle:v05:${suffix}`,
      packRef: structuredClone(packRef),
      fromStatus,
      toStatus,
      evidenceRefs: [`evidence:v05:${suffix}`],
      actor: structuredClone(humanActor),
      createdAt: clock(),
    });
  }
  return packRef;
}

export async function createDemoWorkbenchRuntime({ root } = {}) {
  if (typeof root !== 'string' || root.length === 0) throw new TypeError('demo_root_required');
  await mkdir(root, { recursive: true });
  const projectId = 'project:demo:v05';
  const documentId = 'document:demo:v05';
  const humanActor = { kind: 'HUMAN', id: 'human:v05-local-owner' };
  const clock = advancingClock();
  const idFactory = sequentialIdFactory();
  const sourcePath = await writeDemoSource(join(root, 'source.png'));
  const assetStore = new AssetStore({ root: join(root, 'assets') });
  const artDocumentStore = new ArtDocumentStore({
    path: join(root, 'art.sqlite3'),
    assetStore,
  });
  const operatorStore = new OperatorRegistryStore({ path: join(root, 'operators.sqlite3') });
  const packRef = await activatePack(operatorStore, humanActor, clock);
  const provider = new SharpRasterProvider({ now: clock });
  const capability = await provider.capability();
  if (capability.availability !== 'AVAILABLE') throw new Error('demo_sharp_provider_unavailable');
  const targetResolver = new ArtTargetResolver({ store: artDocumentStore, assetStore });
  const bridge = new WorkbenchExecutionBridge({
    assetStore,
    documentStore: artDocumentStore,
    operatorStore,
    targetResolver,
    providers: [provider],
    manifests: [capability],
    stagingRoot: join(root, 'staging'),
  });
  const projectCreatedAt = clock();
  bridge.createProject({
    schema: 'eve-atelier-art-project/v1',
    projectId,
    canonicalName: 'EveAtelier v0.5 synthetic studio',
    workspaceId: 'workspace:demo:v05',
    assetNamespace: 'asset:demo:v05',
    semanticScope: 'project-local',
    createdAt: projectCreatedAt,
    status: 'ACTIVE',
  });
  const documentCreatedAt = clock();
  await bridge.createDocumentFromSource({
    document: {
      schema: 'eve-atelier-art-document/v1',
      documentId,
      projectId,
      documentType: 'RASTER_ILLUSTRATION',
      colorSpace: 'srgb',
      canvasExtent: { width: 96, height: 96 },
      promotionPolicy: 'human_required',
      createdAt: documentCreatedAt,
      status: 'ACTIVE',
    },
    sourcePath,
    mediaType: 'image/png',
    sourceVersionId: 'version:v05:source',
    assetBindingId: 'binding:v05:source',
    currentEventId: 'current:v05:source',
    actor: humanActor,
    occurredAt: clock(),
  });
  const visualIntelligenceStore = new VisualIntelligenceStore({
    path: join(root, 'visual-intelligence.sqlite3'),
    artDocumentStore,
    operatorStore,
    assetStore,
  });
  const adapter = new WorkbenchRabclAdapter({
    bridge,
    documentStore: artDocumentStore,
    assetStore,
    evaluators: { 'validator:background-removal': evaluateBackgroundRemovalCandidate },
  });
  const knowledgeStore = new VisualKnowledgeStore({
    path: join(root, 'visual-knowledge.sqlite3'),
    assetStore,
    artDocumentStore,
    visualIntelligenceStore,
  });
  visualIntelligenceStore.bindVisualKnowledgeStore(knowledgeStore);
  const controller = new AadsController({
    store: visualIntelligenceStore,
    operatorStore,
    adapter,
    knowledgeStore,
    now: clock,
  });

  const source = artDocumentStore.getDocumentSnapshot(documentId).currentVersion.primaryAsset;
  knowledgeStore.registerSourceIdentity({
    schema: 'eve-atelier-visual-source-identity/v1',
    sourceIdentityId: 'source-identity:v05:demo',
    projectId,
    sourceKind: 'SYNTHETIC',
    canonicalLabel: 'Synthetic blue atelier study',
    rightsClass: 'RIGHTS_CLEAR',
    evidenceClass: 'RIGHTS_CLEAR_REAL',
    evidenceRefs: ['evidence:v05:generated-in-repository-demo'],
    provenance: structuredClone(humanActor),
    createdAt: clock(),
  });
  knowledgeStore.registerReferenceAsset({
    schema: 'eve-atelier-reference-asset/v1',
    referenceAssetId: 'reference-asset:v05:demo-source',
    projectId,
    assetRef: source,
    sourceIdentityId: 'source-identity:v05:demo',
    labels: ['synthetic', 'source', 'blue-study'],
    status: 'ACTIVE',
    evidenceRefs: ['evidence:v05:generated-in-repository-demo'],
    provenance: { kind: 'IMPORT', id: 'eve-atelier:v05-demo-bootstrap' },
    createdAt: clock(),
  });
  for (const [id, role, allowedInfluence] of [
    ['reference-role:v05:identity', 'IDENTITY_REFERENCE', ['IDENTITY', 'STRUCTURE']],
    ['reference-role:v05:line', 'LINE_REFERENCE', ['STYLE', 'SURFACE_RENDERING']],
    ['reference-role:v05:color', 'COLOR_REFERENCE', ['COLOR', 'PALETTE_COMPATIBILITY']],
  ]) {
    knowledgeStore.registerReferenceRole({
      schema: 'eve-atelier-reference-role/v1',
      roleBindingId: id,
      projectId,
      referenceAssetId: 'reference-asset:v05:demo-source',
      role,
      allowedInfluence,
      scope: { kind: 'PROJECT_LOCAL', projectId, taskId: null },
      evidenceRefs: [`evidence:v05:${role.toLowerCase()}`],
      provenance: structuredClone(humanActor),
      createdAt: clock(),
    });
  }

  const sessionPolicy = () => ({
    contextVersion: 1,
    packRef: structuredClone(packRef),
    providerPolicy: {
      allowedPrivacy: ['LOCAL'],
      requiredSupports: [],
      allowedLicenseSpdx: [capability.license.spdx],
      allowedLicenseBoundaries: [capability.license.boundary],
      verifiedAtOrAfter: '2026-09-13T00:00:00Z',
    },
    budget: {
      maxIterations: 20,
      maxProviderCalls: 3,
      maxCandidates: 2,
      maxRepairLoops: 1,
      maxCostUnits: 0,
      maxLatencyMs: 60_000,
    },
    authority: {
      allowedActions: ['PLAN', 'EXECUTE', 'EVALUATE', 'REQUEST_HUMAN', 'PROMOTE', 'STOP'],
      promotionMode: 'POLICY_GATED',
      allowedDecisionKinds: [...AADS_DECISIONS],
      grantedBy: structuredClone(humanActor),
      grantRef: 'authority-grant:v05:local-owner',
    },
    glossary: [{
      term: 'candidate-first',
      meaning: 'Execute, evaluate, review, then promote without overwriting source bytes.',
    }],
    evidenceRefs: ['evidence:v05:human-product-surface'],
    canvasRevision: null,
  });
  const surface = new HumanWorkbenchSurface({
    artDocumentStore,
    assetStore,
    visualIntelligenceStore,
    knowledgeStore,
    controller,
    sessionPolicy,
    humanActor,
    now: clock,
    idFactory,
    defaultWorkspace: { projectId, documentId },
  });

  return {
    root,
    projectId,
    documentId,
    surface,
    assetStore,
    artDocumentStore,
    operatorStore,
    visualIntelligenceStore,
    knowledgeStore,
    controller,
    close() {
      knowledgeStore.close();
      visualIntelligenceStore.close();
      operatorStore.close();
      artDocumentStore.close();
      assetStore.close();
    },
  };
}
