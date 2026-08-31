import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { OperatorRegistryStore } from '../../src/operator-runtime/registry-store.js';
import { PillowRasterProvider } from '../../src/providers/deterministic-raster-provider.js';
import {
  executeInvocation,
  matchProviderCapability,
} from '../../src/operator-runtime/runtime.js';
import {
  validInvocation,
  validPack,
  validProviderManifest,
} from './helpers.js';

function resizeOperator() {
  return validPack().families
    .flatMap(family => family.variants)
    .find(operator => operator.operatorId === 'visual.op.raster.resize');
}

function fixture(path) {
  const result = spawnSync('python3', ['tests/helpers/fixture-image.py', path, 'subject'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

function activeStore() {
  const store = new OperatorRegistryStore({ path: ':memory:' });
  const ref = store.registerPack({
    pack: validPack(),
    proposer: { kind: 'HUMAN', id: 'human:local-reviewer' },
    registeredAt: '2026-08-31T21:30:00+08:00',
  });
  const transitions = [
    ['DRAFT', 'EXPERIMENTAL_UNCALIBRATED'],
    ['EXPERIMENTAL_UNCALIBRATED', 'CALIBRATED'],
    ['CALIBRATED', 'ACTIVE'],
  ];
  transitions.forEach(([fromStatus, toStatus], index) => store.appendLifecycleEvent({
    schema: 'eve-atelier-operator-lifecycle-event/v1',
    eventId: `lifecycle:runtime:${index + 1}`,
    packRef: { packId: ref.packId, version: ref.version, digest: ref.digest },
    fromStatus,
    toStatus,
    evidenceRefs: [`evidence:runtime:${index + 1}`],
    actor: { kind: 'HUMAN', id: 'human:local-reviewer' },
    createdAt: `2026-08-31T21:3${index}:00+08:00`,
  }));
  return { store, ref };
}

test('hard-filters provider capabilities before applying stable evidence and cost ranking', () => {
  const local = validProviderManifest();
  const remote = validProviderManifest();
  remote.providerId = 'provider:remote-fast';
  remote.providerVersion = '1.0';
  remote.privacy = 'REMOTE_PUBLIC';
  remote.operators[0].evidenceLevel = 'PRODUCTION_OBSERVED';
  remote.operators[0].costRank = 0;
  remote.operators[0].latencyRank = 0;
  const unavailable = validProviderManifest();
  unavailable.providerId = 'provider:unavailable';
  unavailable.availability = 'UNAVAILABLE';

  const selected = matchProviderCapability({
    manifests: [remote, unavailable, local],
    operator: resizeOperator(),
    policy: { allowedPrivacy: ['LOCAL'], requiredCapabilities: ['raster.resize'] },
  });

  assert.equal(selected.providerId, 'provider:pillow-reference');
});

test('rejects authority fields hidden in direct provider matching policy', () => {
  assert.throws(() => matchProviderCapability({
    manifests: [validProviderManifest()],
    operator: resizeOperator(),
    policy: {
      allowedPrivacy: ['LOCAL'],
      requiredCapabilities: ['raster.resize'],
      promotion: true,
    },
  }), /provider_policy_field_forbidden:promotion/);
});

test('executes an ACTIVE provider-bound resize and records receipt evidence without promotion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-operator-runtime-'));
  const input = join(directory, 'source.png');
  const output = join(directory, 'resized.png');
  fixture(input);
  const { store, ref } = activeStore();
  try {
    const invocation = validInvocation();
    invocation.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
    invocation.input = input;
    invocation.output = output;
    const provider = new PillowRasterProvider();

    const receipt = await executeInvocation({
      store,
      manifests: [validProviderManifest()],
      providers: [provider],
      invocation,
      now: () => '2026-08-31T21:40:00+08:00',
    });

    assert.equal(receipt.status, 'completed');
    assert.deepEqual(receipt.packRef, invocation.packRef);
    assert.deepEqual(receipt.operatorRef, invocation.operatorRef);
    assert.deepEqual(receipt.providerRef, {
      providerId: 'provider:pillow-reference',
      providerVersion: '0.1',
    });
    assert.deepEqual(receipt.metadata, { width: 4, height: 5 });
    assert.equal('acceptance' in receipt, false);
    assert.equal('promotion' in receipt, false);
    const experiences = store.listExperience({ operatorId: 'visual.op.raster.resize' });
    assert.equal(experiences.length, 1);
    assert.equal(experiences[0].outcome, 'COMPLETED');
    assert.equal(experiences[0].inputHashes.length, 1);
    assert.equal(experiences[0].outputHashes.length, 1);
  } finally {
    store.close();
  }
});

test('rejects inactive packs, compile-only operators, and invalid canonical parameters', async () => {
  const draftStore = new OperatorRegistryStore({ path: ':memory:' });
  try {
    const draftRef = draftStore.registerPack({
      pack: validPack(),
      proposer: { kind: 'HUMAN', id: 'human:local-reviewer' },
      registeredAt: '2026-08-31T21:30:00+08:00',
    });
    const draftInvocation = validInvocation();
    draftInvocation.packRef = {
      packId: draftRef.packId,
      version: draftRef.version,
      digest: draftRef.digest,
    };
    await assert.rejects(() => executeInvocation({
      store: draftStore,
      manifests: [validProviderManifest()],
      providers: [],
      invocation: draftInvocation,
    }), /operator_pack_not_active/);
  } finally {
    draftStore.close();
  }

  const cases = [
    [
      'compile-only operator',
      invocation => {
        invocation.operatorRef = {
          operatorId: 'visual.op.semantic.adjust_axis',
          version: '1.0.0',
        };
        invocation.params = {};
      },
      /operator_not_provider_bound/,
    ],
    [
      'unknown parameter',
      invocation => { invocation.params.denoise = 0.4; },
      /operator_parameter_unknown:visual.op.raster.resize:denoise/,
    ],
    [
      'missing parameter',
      invocation => { delete invocation.params.width; },
      /operator_parameter_required:visual.op.raster.resize:width/,
    ],
    [
      'out-of-range parameter',
      invocation => { invocation.params.width = 0; },
      /operator_parameter_invalid:visual.op.raster.resize:width/,
    ],
  ];
  for (const [name, mutate, expected] of cases) {
    const { store, ref } = activeStore();
    try {
      const invocation = validInvocation();
      invocation.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
      mutate(invocation);
      await assert.rejects(() => executeInvocation({
        store,
        manifests: [validProviderManifest()],
        providers: [],
        invocation,
      }), expected, name);
    } finally {
      store.close();
    }
  }
});

test('rejects provider binding and receipt identity mismatches before recording evidence', async () => {
  const cases = [
    [
      'missing provider object',
      [],
      /provider_object_identity_mismatch/,
    ],
    [
      'mismatched receipt',
      [{
        providerId: 'provider:pillow-reference',
        providerVersion: '0.1',
        async execute() {
          return {
            providerId: 'provider:other',
            providerVersion: '0.1',
            operatorId: 'visual.op.raster.resize',
            metadata: {},
          };
        },
      }],
      /provider_receipt_identity_mismatch/,
    ],
  ];
  for (const [name, providers, expected] of cases) {
    const { store, ref } = activeStore();
    try {
      const invocation = validInvocation();
      invocation.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
      await assert.rejects(() => executeInvocation({
        store,
        manifests: [validProviderManifest()],
        providers,
        invocation,
      }), expected, name);
      assert.deepEqual(store.listExperience({ operatorId: invocation.operatorRef.operatorId }), []);
    } finally {
      store.close();
    }
  }
});
