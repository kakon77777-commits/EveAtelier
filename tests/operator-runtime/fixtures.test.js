import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateOperatorPack,
  validateProviderCapabilityManifest,
} from '../../src/operator-runtime/contracts.js';

async function readJson(relativePath) {
  const url = new URL(`../../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

test('tracked Phase 2A fixtures are dynamic, valid, and public-safe', async () => {
  const pack = await readJson('fixtures/operator_runtime/core-pack.example.json');
  const manifest = await readJson(
    'fixtures/operator_runtime/provider-capabilities.example.json',
  );

  assert.deepEqual(validateOperatorPack(pack), { ok: true });
  assert.deepEqual(validateProviderCapabilityManifest(manifest), { ok: true });
  assert.ok(pack.axes.some(axis => axis.axisId === 'semantic.axis.example.intensity'));
  assert.ok(pack.families.some(family => family.variants.some(
    variant => variant.operatorId === 'visual.op.semantic.adjust_axis',
  )));
  assert.ok(pack.families.some(family => family.variants.some(
    variant => variant.operatorId === 'visual.op.raster.resize',
  )));

  const serialized = JSON.stringify({ pack, manifest });
  assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]/);
  assert.doesNotMatch(serialized, /AI_RESIDENCE|wanxiang|1086|candidate-002/i);
  assert.doesNotMatch(serialized, /providerParameters|modelId|prompt|promotion/i);
});
