import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { validateOperatorPack } from '../../src/operator-runtime/contracts.js';
import {
  chooseFallbackDecision,
  matchArtProviderCapability,
  validateArtProviderCapability,
} from '../../src/art-domain/provider-capability.js';
import { SharpRasterProvider } from '../../src/providers/sharp-raster-provider.js';
import { validateBackgroundRemoval } from '../../src/evaluation.js';
import { writeOverlay, writeSubject } from './helpers.js';

const verifiedAt = '2026-09-11T01:00:00+08:00';

async function packFixture() {
  return JSON.parse(await readFile(new URL(
    '../../fixtures/operator_runtime/v02-deterministic-pack.example.json',
    import.meta.url,
  ), 'utf8'));
}

function request(operatorId, input, output, params) {
  return {
    operationId: `operation:test:${operatorId}`,
    packRef: { packId: 'operator-pack:test', version: '1.0.0', digest: 'a'.repeat(64) },
    operatorRef: { operatorId, version: '1.0.0' },
    operatorId,
    inputArtifactId: 'asset:test:input',
    outputArtifactId: `asset:test:output:${operatorId}`,
    input,
    output,
    params,
  };
}

function requirements(overrides = {}) {
  return {
    allowedPrivacy: ['LOCAL'],
    inputKind: 'raster.image',
    outputKind: 'raster.image',
    locality: 'GLOBAL',
    width: 16,
    height: 16,
    requiredSupports: ['alpha'],
    requiredCapabilities: [],
    allowedDeterminism: ['DETERMINISTIC'],
    allowedReproducibility: ['EXACT'],
    allowedLicenseSpdx: ['Apache-2.0 AND LGPL-3.0-or-later'],
    allowedLicenseBoundaries: ['LIBRARY'],
    verifiedAtOrAfter: '2026-09-11T00:00:00+08:00',
    ...overrides,
  };
}

test('validates the v0.2 operator pack and hard-filters the real sharp capability', async () => {
  const pack = await packFixture();
  assert.deepEqual(validateOperatorPack(pack), { ok: true });
  const provider = new SharpRasterProvider({ now: () => verifiedAt });
  const probe = await provider.probe();
  assert.deepEqual(probe.available, true, JSON.stringify(probe));
  assert.equal(probe.runtime.sharp, '0.35.4');
  const manifest = await provider.capability();
  assert.deepEqual(validateArtProviderCapability(manifest), { ok: true });
  assert.equal(matchArtProviderCapability({
    manifests: [manifest],
    operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
    requirements: requirements({ requiredCapabilities: ['raster.resize'] }),
  }).providerId, provider.providerId);

  for (const [name, mutate] of [
    ['alpha', value => { value.requiredSupports = ['structure']; }],
    ['dimensions', value => { value.width = 20000; }],
    ['freshness', value => { value.verifiedAtOrAfter = '2026-09-12T00:00:00+08:00'; }],
    ['license', value => { value.allowedLicenseSpdx = ['MIT']; }],
    ['locality', value => { value.locality = 'POINT'; }],
  ]) {
    const value = requirements({ requiredCapabilities: ['raster.resize'] });
    mutate(value);
    assert.throws(() => matchArtProviderCapability({
      manifests: [manifest],
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      requirements: value,
    }), /no_compatible_art_provider/, name);
  }
});

test('executes the complete deterministic sharp catalog with real output bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-sharp-'));
  const source = await writeSubject(join(root, 'source.png'));
  const overlay = await writeOverlay(join(root, 'overlay.png'), { width: 16, height: 16 });
  const provider = new SharpRasterProvider();
  const outputs = [];
  const run = async (operatorId, name, input, params) => {
    const output = join(root, name);
    const result = await provider.execute(request(operatorId, input, output, params));
    assert.equal(result.providerId, provider.providerId);
    assert.equal(result.output, output);
    assert.match(result.outputSha256, /^[a-f0-9]{64}$/);
    outputs.push(result);
    return output;
  };

  await run('visual.op.raster.crop', 'crop.png', source, {
    left: 2, top: 2, width: 10, height: 10,
  });
  await run('visual.op.raster.resize', 'resize.png', source, {
    width: 8, height: 9, fit: 'fill',
  });
  await run('visual.op.raster.rotate', 'rotate.png', source, { angle: 90 });
  const mask = await run('visual.op.raster.create_mask', 'mask.png', source, {
    background: [255, 255, 255], tolerance: 8,
  });
  const alpha = await run('visual.op.raster.create_alpha', 'alpha.png', source, { mask });
  const edge = await run('visual.op.raster.edge_cleanup', 'edge.png', alpha, { radius: 1, mask });
  const beforeEdge = await sharp(alpha).ensureAlpha().raw().toBuffer();
  const afterEdge = await sharp(edge).ensureAlpha().raw().toBuffer();
  const locality = await sharp(mask).greyscale().raw().toBuffer();
  for (let index = 0; index < locality.length; index += 1) {
    if (locality[index] === 0) {
      assert.equal(afterEdge[(index * 4) + 3], beforeEdge[(index * 4) + 3]);
    }
  }
  await run('visual.op.raster.recolor', 'recolor.png', source, { tint: [1, 0.5, 0.5] });
  await run('visual.op.composite.layer_composite', 'composite.png', source, {
    overlay, left: 2, top: 2, opacity: 0.5, blend: 'over', mask,
  });
  await run('visual.op.raster.convert_format', 'converted.jpg', source, {
    format: 'jpeg', quality: 90,
  });
  await run('visual.op.raster.basic_filter', 'filtered.png', source, {
    filter: 'BLUR', amount: 1, colourspace: 'srgb',
  });
  assert.equal(outputs.length, 10);
  const maskInfo = await sharp(mask).metadata();
  assert.equal(maskInfo.channels, 1);
  const alphaInfo = await sharp(alpha).metadata();
  assert.equal(alphaInfo.hasAlpha, true);
});

test('uses libvips for a bounded large-image resize and reports fallback decisions separately', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-sharp-large-'));
  const source = await writeSubject(join(root, 'large.png'), { width: 2048, height: 2048 });
  const output = join(root, 'large-resized.png');
  const provider = new SharpRasterProvider();
  await provider.execute(request('visual.op.raster.resize', source, output, {
    width: 256, height: 256, fit: 'fill',
  }));
  const metadata = await sharp(output).metadata();
  assert.deepEqual([metadata.width, metadata.height], [256, 256]);

  assert.equal(chooseFallbackDecision({
    failureClass: 'PROVIDER_UNAVAILABLE',
    alternativeProviderAvailable: true,
    localRepairAvailable: false,
    stochastic: false,
  }), 'REBIND');
  assert.equal(chooseFallbackDecision({
    failureClass: 'QUALITY_FAILURE',
    alternativeProviderAvailable: false,
    localRepairAvailable: true,
    stochastic: true,
  }), 'REPAIR');
  assert.equal(chooseFallbackDecision({
    failureClass: 'QUALITY_FAILURE',
    alternativeProviderAvailable: false,
    localRepairAvailable: false,
    stochastic: true,
  }), 'RESAMPLE');
  assert.equal(chooseFallbackDecision({
    failureClass: 'PROVIDER_FAMILY_MISMATCH',
    alternativeProviderAvailable: false,
    localRepairAvailable: false,
    stochastic: false,
  }), 'SWITCH_BACKEND');
  assert.equal(chooseFallbackDecision({
    failureClass: 'CONSTRAINT_FAILURE',
    alternativeProviderAvailable: false,
    localRepairAvailable: false,
    stochastic: false,
  }), 'RECOMPILE_REQUEST');
  assert.equal(chooseFallbackDecision({
    failureClass: 'UNKNOWN_FAILURE',
    alternativeProviderAvailable: false,
    localRepairAvailable: false,
    stochastic: false,
  }), 'ASK_HUMAN');
});

test('deterministic background validation rejects all-black and all-white masks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-mask-negative-'));
  const source = await writeSubject(join(root, 'source.png'));
  const provider = new SharpRasterProvider();
  for (const [name, fill] of [['black', 0], ['white', 255]]) {
    const mask = join(root, `${name}-mask.png`);
    await sharp(Buffer.alloc(16 * 16, fill), {
      raw: { width: 16, height: 16, channels: 1 },
    }).toColourspace('b-w').png().toFile(mask);
    const output = join(root, `${name}-alpha.png`);
    await provider.execute(request('visual.op.raster.create_alpha', source, output, { mask }));
    assert.equal(validateBackgroundRemoval(output).verdict, 'REPAIR', name);
  }
});

test('preserves an embedded sRGB profile on metadata-preserving operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v02-icc-'));
  const source = await writeSubject(join(root, 'source.png'));
  const tagged = join(root, 'tagged.png');
  await sharp(source).withIccProfile('srgb').toFile(tagged);
  const before = await sharp(tagged).metadata();
  assert.ok(before.icc?.length > 0);
  const output = join(root, 'resized.png');
  const provider = new SharpRasterProvider();
  await provider.execute(request('visual.op.raster.resize', tagged, output, {
    width: 8, height: 8, fit: 'fill',
  }));
  const after = await sharp(output).metadata();
  assert.ok(after.icc?.length > 0);
  assert.equal(after.space, 'srgb');
});
