import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindReferenceRoles,
  buildGenerationRequest,
  validateCharacterRemasterIntent,
} from '../../src/character-remaster/contracts.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function assetPack() {
  const directory = await mkdtemp(join(tmpdir(), 'eve-remaster-contracts-'));
  const sourceAsset = join(directory, 'source.png');
  const paths = {
    line_reference: join(directory, 'line.png'),
    color_reference: join(directory, 'color.png'),
    negative_reference: join(directory, 'negative.png'),
  };
  await writeFile(sourceAsset, 'source-bytes');
  await Promise.all(Object.entries(paths).map(([role, path]) => writeFile(path, `${role}-bytes`)));
  return {
    directory,
    sourceAsset,
    references: Object.entries(paths).map(([role, path]) => ({ role, path })),
  };
}

const validIntent = {
  taskId: 'character-remaster-001',
  goal: 'character_remaster',
  intentText: ['Preserve identity', 'Cleaner line work', 'Low-saturation wuxia direction'],
  negativePrompt: 'homogenized face, identity drift, distorted anatomy, artifacts',
  constraints: {
    candidateCount: 2,
    humanReviewRequired: true,
    identity: 'hard',
    styleDirection: 'strong',
    artifactQuality: 'strong',
    baseSeed: 41,
  },
};

test('validates the bounded human-reviewed character remaster intent', () => {
  assert.deepEqual(validateCharacterRemasterIntent(validIntent), { ok: true });
  assert.deepEqual(
    validateCharacterRemasterIntent({
      ...validIntent,
      constraints: { ...validIntent.constraints, candidateCount: 1 },
    }),
    { ok: false, reason: 'candidate_count_must_be_2_to_4' },
  );
});

test('binds each required reference role to a real byte identity', async () => {
  const pack = await assetPack();
  const assets = bindReferenceRoles(pack);

  assert.equal(assets.source.path, pack.sourceAsset);
  assert.equal(assets.source.sha256, sha256('source-bytes'));
  assert.deepEqual(
    assets.references.map(item => item.role),
    ['line_reference', 'color_reference', 'negative_reference'],
  );
  assert.equal(
    assets.byRole.color_reference.sha256,
    sha256('color_reference-bytes'),
  );

  assert.throws(
    () => bindReferenceRoles({
      sourceAsset: pack.sourceAsset,
      references: pack.references.filter(item => item.role !== 'negative_reference'),
    }),
    /missing_reference_role:negative_reference/,
  );
});

test('builds a provider-neutral generation variation request with a distinct candidate seed', async () => {
  const pack = await assetPack();
  const assets = bindReferenceRoles(pack);
  const outputPath = join(tmpdir(), 'eve-candidate-2.png');
  const request = buildGenerationRequest({
    intent: validIntent,
    assets,
    candidateIndex: 1,
    outputPath,
  });

  assert.equal(request.operationId, 'character-remaster-001:candidate:2');
  assert.equal(request.operatorId, 'visual.op.generative.generate_variation');
  assert.equal(request.seed, 42);
  assert.equal(request.negativePrompt, validIntent.negativePrompt);
  assert.equal(request.outputPath, outputPath);
  assert.equal(request.source.sha256, sha256('source-bytes'));
  assert.deepEqual(
    request.references.map(item => item.role),
    ['line_reference', 'color_reference', 'negative_reference'],
  );
});

test('preserves multiple negative references without selecting a primary', async () => {
  const pack = await assetPack();
  const secondNegative = join(pack.directory, 'negative-second.png');
  await writeFile(secondNegative, 'negative-reference-second-bytes');
  const assets = bindReferenceRoles({
    sourceAsset: pack.sourceAsset,
    references: [
      ...pack.references,
      { role: 'negative_reference', path: secondNegative },
    ],
  });

  assert.equal(Array.isArray(assets.byRole.negative_reference), true);
  assert.deepEqual(
    assets.byRole.negative_reference.map(item => item.sha256),
    [
      sha256('negative_reference-bytes'),
      sha256('negative-reference-second-bytes'),
    ],
  );
  assert.equal(
    assets.references.filter(item => item.role === 'negative_reference').length,
    2,
  );
});
