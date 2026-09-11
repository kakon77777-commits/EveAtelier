import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetStore } from '../../src/art-domain/asset-store.js';
import { ArtDocumentStore } from '../../src/art-domain/store.js';
import { ArtTargetResolver } from '../../src/art-domain/target-resolver.js';
import { WorkbenchExecutionBridge } from '../../src/art-domain/workbench-runtime.js';
import { OperatorRegistryStore } from '../../src/operator-runtime/registry-store.js';
import { SharpRasterProvider } from '../../src/providers/sharp-raster-provider.js';
import { evaluateBackgroundRemovalCandidate } from '../../src/visual-intelligence/evaluators.js';
import { VisualIntelligenceStore } from '../../src/visual-intelligence/session-store.js';
import { WorkbenchRabclAdapter } from '../../src/visual-intelligence/workbench-adapter.js';
import { AadsController } from '../../src/visual-intelligence/controller.js';
import { AADS_DECISIONS } from '../../src/visual-intelligence/contracts.js';
import { documentRecord, projectRecord, writeSubject } from '../art-domain/helpers.js';

export const initialAt = '2026-09-11T03:00:00Z';
export const human = { kind: 'HUMAN', id: 'human:v03-owner' };

export function advancingClock(start = '2026-09-11T04:00:00Z') {
  let milliseconds = Date.parse(start);
  return () => new Date(milliseconds += 1000).toISOString();
}

async function loadPack() {
  return JSON.parse(await readFile(new URL(
    '../../fixtures/operator_runtime/v02-deterministic-pack.example.json',
    import.meta.url,
  ), 'utf8'));
}

function activatePack(store, pack) {
  const registered = store.registerPack({ pack, proposer: human, registeredAt: initialAt });
  const packRef = {
    packId: registered.packId,
    version: registered.version,
    digest: registered.digest,
  };
  for (const [eventId, fromStatus, toStatus, createdAt] of [
    ['lifecycle:v03:experimental', 'DRAFT', 'EXPERIMENTAL_UNCALIBRATED', '2026-09-11T03:00:01Z'],
    ['lifecycle:v03:calibrated', 'EXPERIMENTAL_UNCALIBRATED', 'CALIBRATED', '2026-09-11T03:00:02Z'],
    ['lifecycle:v03:active', 'CALIBRATED', 'ACTIVE', '2026-09-11T03:00:03Z'],
  ]) {
    store.appendLifecycleEvent({
      schema: 'eve-atelier-operator-lifecycle-event/v1',
      eventId,
      packRef: structuredClone(packRef),
      fromStatus,
      toStatus,
      evidenceRefs: [`evidence:${eventId}`],
      actor: human,
      createdAt,
    });
  }
  return packRef;
}

export function providerPolicy(capability) {
  return {
    allowedPrivacy: ['LOCAL'],
    requiredSupports: [],
    allowedLicenseSpdx: [capability.license.spdx],
    allowedLicenseBoundaries: [capability.license.boundary],
    verifiedAtOrAfter: '2026-09-11T00:00:00Z',
  };
}

export function sessionBudget(overrides = {}) {
  return {
    maxIterations: 20,
    maxProviderCalls: 3,
    maxCandidates: 2,
    maxRepairLoops: 1,
    maxCostUnits: 0,
    maxLatencyMs: 60_000,
    ...overrides,
  };
}

export function sessionAuthority(overrides = {}) {
  return {
    allowedActions: ['PLAN', 'EXECUTE', 'EVALUATE', 'REQUEST_HUMAN', 'PROMOTE', 'STOP'],
    promotionMode: 'POLICY_GATED',
    allowedDecisionKinds: [...AADS_DECISIONS],
    grantedBy: structuredClone(human),
    grantRef: 'authority-grant:v03:owner',
    ...overrides,
  };
}

export function backgroundIntent(overrides = {}) {
  return {
    schema: 'eve-atelier-visual-intent/v1',
    intentId: 'intent:v03:background-removal',
    projectId: 'project:synthetic:v02',
    documentId: 'document:synthetic:v02',
    text: '把背景去掉，邊緣不要有白邊。',
    taskTypeHint: 'UNKNOWN',
    references: [],
    preferences: [],
    hardConstraints: [],
    overrides: [],
    submittedBy: structuredClone(human),
    submittedAt: '2026-09-11T03:30:00Z',
    ...overrides,
  };
}

export async function setupVisualIntelligence({
  promotionPolicy = 'human_required',
  provider: suppliedProvider = null,
  evaluator = evaluateBackgroundRemovalCandidate,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eve-v03-'));
  const source = await writeSubject(join(root, 'source.png'));
  const sourceSha256 = createHash('sha256').update(readFileSync(source)).digest('hex');
  const assetStore = new AssetStore({ root: join(root, 'assets') });
  const documentStore = new ArtDocumentStore({
    path: join(root, 'art.sqlite3'),
    assetStore,
  });
  const operatorStore = new OperatorRegistryStore({ path: join(root, 'operators.sqlite3') });
  const packRef = activatePack(operatorStore, await loadPack());
  const provider = suppliedProvider ?? new SharpRasterProvider({
    now: () => '2026-09-11T03:00:04Z',
  });
  const capability = await provider.capability();
  const targetResolver = new ArtTargetResolver({ store: documentStore, assetStore });
  const bridge = new WorkbenchExecutionBridge({
    assetStore,
    documentStore,
    operatorStore,
    targetResolver,
    providers: [provider],
    manifests: [capability],
    stagingRoot: join(root, 'staging'),
  });
  bridge.createProject(projectRecord(initialAt));
  await bridge.createDocumentFromSource({
    document: { ...documentRecord(initialAt), promotionPolicy },
    sourcePath: source,
    mediaType: 'image/png',
    sourceVersionId: 'version:v03:source',
    assetBindingId: 'binding:v03:source',
    currentEventId: 'current:v03:initial',
    actor: human,
    occurredAt: initialAt,
  });
  const visualStore = new VisualIntelligenceStore({
    path: join(root, 'visual-intelligence.sqlite3'),
    artDocumentStore: documentStore,
    operatorStore,
    assetStore,
  });
  const adapter = new WorkbenchRabclAdapter({
    bridge,
    documentStore,
    assetStore,
    evaluators: { 'validator:background-removal': evaluator },
  });
  const clock = advancingClock();
  const controller = new AadsController({
    store: visualStore,
    operatorStore,
    adapter,
    now: clock,
  });
  return {
    root,
    source,
    sourceSha256,
    assetStore,
    documentStore,
    operatorStore,
    visualStore,
    targetResolver,
    bridge,
    provider,
    capability,
    packRef,
    adapter,
    controller,
    clock,
  };
}

export function startBackgroundSession(context, overrides = {}) {
  return context.controller.startSession({
    intent: backgroundIntent(overrides.intent),
    sessionId: overrides.sessionId ?? 'session:v03:background-removal',
    packetId: overrides.packetId ?? 'packet:v03:background-removal',
    planId: overrides.planId ?? 'plan:v03:background-removal',
    workflowId: overrides.workflowId ?? 'workflow:v03:background-removal',
    contextSnapshotId: overrides.contextSnapshotId ?? 'context:v03:background-removal',
    contextVersion: overrides.contextVersion ?? 1,
    packRef: context.packRef,
    providerPolicy: providerPolicy(context.capability),
    budget: overrides.budget ?? sessionBudget(),
    authority: overrides.authority ?? sessionAuthority(),
    glossary: [{
      term: 'candidate-first',
      meaning: 'Execute, evaluate, review, then promote without overwriting source bytes.',
    }],
    evidenceRefs: ['evidence:v03:roadmap-bound'],
  });
}

export function closeVisualIntelligence(context) {
  context.visualStore.close();
  context.operatorStore.close();
  context.documentStore.close();
  context.assetStore.close();
}
