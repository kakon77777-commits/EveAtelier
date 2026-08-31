import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

function verifiedRevisionGuard() {
  return { ok: true, evidenceRef: 'revision-check:example:verified' };
}

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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
      revisionGuard: ({ target, expectedRevision }) => ({
        ok: target.id === invocation.target.id && expectedRevision === 3,
        evidenceRef: 'revision-check:example:001',
      }),
    });

    assert.equal(receipt.status, 'completed');
    assert.deepEqual(receipt.packRef, invocation.packRef);
    assert.deepEqual(receipt.operatorRef, invocation.operatorRef);
    assert.deepEqual(receipt.providerRef, {
      providerId: 'provider:pillow-reference',
      providerVersion: '0.1',
    });
    assert.deepEqual(receipt.metadata, { width: 4, height: 5 });
    assert.deepEqual(receipt.inputArtifacts, [{
      artifactId: invocation.inputArtifactId,
      sha256: fileHash(input),
    }]);
    assert.deepEqual(receipt.outputArtifacts, [{
      artifactId: invocation.outputArtifactId,
      sha256: fileHash(output),
    }]);
    assert.equal('inputRefs' in receipt, false);
    assert.equal('outputRefs' in receipt, false);
    assert.doesNotMatch(JSON.stringify(receipt), /eve-operator-runtime-|source\.png|resized\.png/);
    assert.deepEqual(receipt.revisionValidation, {
      status: 'VERIFIED',
      evidenceRef: 'revision-check:example:001',
    });
    assert.equal('acceptance' in receipt, false);
    assert.equal('promotion' in receipt, false);
    const experiences = store.listExperience({ operatorId: 'visual.op.raster.resize' });
    assert.deepEqual(experiences.map(event => event.outcome), ['PREPARED', 'COMPLETED']);
    assert.equal(experiences[0].inputHashes.length, 1);
    assert.equal(experiences[0].outputHashes.length, 0);
    assert.equal(experiences[1].outputHashes.length, 1);
    assert.ok(experiences.every(event => event.evidenceClass === 'CONTRACT_TESTED'));
  } finally {
    store.close();
  }
});

test('requires a revision guard and rejects stale targets before provider execution', async () => {
  const { store, ref } = activeStore();
  let calls = 0;
  const provider = {
    providerId: 'provider:pillow-reference',
    providerVersion: '0.1',
    async execute() {
      calls += 1;
      throw new Error('provider_should_not_run');
    },
  };
  try {
    const invocation = validInvocation();
    invocation.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
    await assert.rejects(() => executeInvocation({
      store,
      manifests: [validProviderManifest()],
      providers: [provider],
      invocation,
    }), /revision_guard_required/);
    await assert.rejects(() => executeInvocation({
      store,
      manifests: [validProviderManifest()],
      providers: [provider],
      invocation,
      revisionGuard: () => ({ ok: false, reason: 'stale_revision' }),
    }), /stale_revision/);
    await assert.rejects(() => executeInvocation({
      store,
      manifests: [validProviderManifest()],
      providers: [provider],
      invocation,
      revisionGuard: () => ({
        ok: true,
        evidenceRef: 'D:\\private\\revision-evidence.json',
      }),
    }), /revision_validation_evidence_ref_invalid/);
    assert.equal(calls, 0);
    assert.deepEqual(store.listExperience({ operatorId: invocation.operatorRef.operatorId }), []);
  } finally {
    store.close();
  }
});

test('rejects a pre-existing output before a provider can attest stale bytes as new work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-operator-stale-output-'));
  const input = join(directory, 'source.png');
  const output = join(directory, 'stale-output.png');
  fixture(input);
  fixture(output);
  const { store, ref } = activeStore();
  let calls = 0;
  const provider = {
    providerId: 'provider:pillow-reference',
    providerVersion: '0.1',
    async execute(request) {
      calls += 1;
      return {
        providerId: this.providerId,
        providerVersion: this.providerVersion,
        operatorId: request.operatorId,
        output: request.output,
        metadata: { width: 4, height: 5 },
      };
    },
  };
  try {
    const invocation = validInvocation();
    invocation.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
    invocation.input = input;
    invocation.output = output;
    await assert.rejects(() => executeInvocation({
      store,
      manifests: [validProviderManifest()],
      providers: [provider],
      invocation,
      revisionGuard: verifiedRevisionGuard,
    }), /operator_output_must_not_exist/);
    assert.equal(calls, 0);
    assert.deepEqual(store.listExperience({ operatorId: invocation.operatorRef.operatorId }), []);
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
        revisionGuard: verifiedRevisionGuard,
      }), expected, name);
    } finally {
      store.close();
    }
  }
});

test('rejects provider binding and receipt identity mismatches before recording evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-operator-provider-mismatch-'));
  const input = join(directory, 'source.png');
  fixture(input);
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
      invocation.input = input;
      invocation.output = join(directory, `output-${name.replaceAll(' ', '-')}.png`);
      await assert.rejects(() => executeInvocation({
        store,
        manifests: [validProviderManifest()],
        providers,
        invocation,
        revisionGuard: verifiedRevisionGuard,
      }), expected, name);
      const experiences = store.listExperience({ operatorId: invocation.operatorRef.operatorId });
      if (name === 'missing provider object') {
        assert.deepEqual(experiences, []);
      } else {
        assert.deepEqual(experiences.map(event => event.outcome), ['PREPARED', 'FAILED']);
        assert.equal(experiences[1].failureClass, 'provider_receipt_identity_mismatch');
      }
    } finally {
      store.close();
    }
  }
});

test('rejects a provider result that omits exact operation, pack, and operator-version attestation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-operator-attestation-'));
  const input = join(directory, 'source.png');
  const output = join(directory, 'output.png');
  fixture(input);
  const { store, ref } = activeStore();
  const provider = {
    providerId: 'provider:pillow-reference',
    providerVersion: '0.1',
    async execute(request) {
      copyFileSync(request.input, request.output);
      return {
        providerId: this.providerId,
        providerVersion: this.providerVersion,
        operatorId: request.operatorId,
        output: request.output,
        metadata: { width: 4, height: 5 },
      };
    },
  };
  try {
    const invocation = validInvocation();
    invocation.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
    invocation.input = input;
    invocation.output = output;
    await assert.rejects(() => executeInvocation({
      store,
      manifests: [validProviderManifest()],
      providers: [provider],
      invocation,
      revisionGuard: verifiedRevisionGuard,
    }), /provider_receipt_identity_mismatch/);
    const experiences = store.listExperience({ operatorId: invocation.operatorRef.operatorId });
    assert.deepEqual(experiences.map(event => event.outcome), ['PREPARED', 'FAILED']);
    assert.equal(experiences[1].failureClass, 'provider_receipt_identity_mismatch');
    assert.equal(experiences[1].outputHashes[0], fileHash(output));
  } finally {
    store.close();
  }
});

test('rejects provider metadata that carries authority or private-path fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-operator-metadata-'));
  const input = join(directory, 'source.png');
  const output = join(directory, 'output.png');
  fixture(input);
  const { store, ref } = activeStore();
  const provider = {
    providerId: 'provider:pillow-reference',
    providerVersion: '0.1',
    async execute(request) {
      copyFileSync(request.input, request.output);
      return {
        providerId: this.providerId,
        providerVersion: this.providerVersion,
        operationId: request.operationId,
        packRef: structuredClone(request.packRef),
        operatorRef: structuredClone(request.operatorRef),
        inputArtifactId: request.inputArtifactId,
        outputArtifactId: request.outputArtifactId,
        output: request.output,
        outputSha256: fileHash(request.output),
        metadata: {
          width: 4,
          height: 5,
          acceptance: 'ACCEPT',
          privatePath: 'D:\\private\\model.bin',
        },
      };
    },
  };
  try {
    const invocation = validInvocation();
    invocation.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
    invocation.input = input;
    invocation.output = output;
    await assert.rejects(() => executeInvocation({
      store,
      manifests: [validProviderManifest()],
      providers: [provider],
      invocation,
      revisionGuard: verifiedRevisionGuard,
    }), /provider_receipt_metadata_field_forbidden:acceptance/);
    const experiences = store.listExperience({ operatorId: invocation.operatorRef.operatorId });
    assert.deepEqual(experiences.map(event => event.outcome), ['PREPARED', 'FAILED']);
    assert.equal(experiences[1].failureClass, 'provider_receipt_metadata_field_forbidden');
  } finally {
    store.close();
  }
});

test('rejects unknown top-level fields in the provider execution result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-operator-result-schema-'));
  const input = join(directory, 'source.png');
  const output = join(directory, 'output.png');
  fixture(input);
  const { store, ref } = activeStore();
  const provider = {
    providerId: 'provider:pillow-reference',
    providerVersion: '0.1',
    async execute(request) {
      copyFileSync(request.input, request.output);
      return {
        providerId: this.providerId,
        providerVersion: this.providerVersion,
        operationId: request.operationId,
        packRef: structuredClone(request.packRef),
        operatorRef: structuredClone(request.operatorRef),
        operatorId: request.operatorId,
        inputArtifactId: request.inputArtifactId,
        outputArtifactId: request.outputArtifactId,
        output: request.output,
        outputSha256: fileHash(request.output),
        metadata: { width: 4, height: 5 },
        promotion: true,
      };
    },
  };
  try {
    const invocation = validInvocation();
    invocation.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
    invocation.input = input;
    invocation.output = output;
    await assert.rejects(() => executeInvocation({
      store,
      manifests: [validProviderManifest()],
      providers: [provider],
      invocation,
      revisionGuard: verifiedRevisionGuard,
    }), /provider_result_field_forbidden:promotion/);
  } finally {
    store.close();
  }
});
