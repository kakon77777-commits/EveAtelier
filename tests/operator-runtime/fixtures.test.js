import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateCounterfactualObservation,
  validateCounterfactualPrediction,
  validateOperatorPack,
  validateOperatorProposal,
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

test('tracked Phase 2B fixture separates prediction, observation, and proposal without private evidence', async () => {
  const fixture = await readJson(
    'fixtures/operator_runtime/vusd-counterfactual.example.json',
  );

  assert.deepEqual(validateCounterfactualPrediction(fixture.prediction), { ok: true });
  assert.deepEqual(validateCounterfactualObservation(fixture.observation), { ok: true });
  assert.deepEqual(validateOperatorProposal(fixture.proposal), { ok: true });
  assert.equal(fixture.observation.predictionId, fixture.prediction.predictionId);
  assert.deepEqual(fixture.proposal.residualRefs, [fixture.observation.observationId]);

  const serialized = JSON.stringify(fixture);
  assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]/);
  assert.doesNotMatch(serialized, /AI_RESIDENCE|wanxiang|3011|09_11_00|09_16_57/i);
  assert.doesNotMatch(serialized, /providerParameters|modelId|prompt|promotion|ACTIVE/i);
});
