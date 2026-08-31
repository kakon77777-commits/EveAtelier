import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  compileStyleConstraintPacket,
  createSameSeriesReview,
} from '../../src/style-control/contracts.js';

async function readJson(relativePath) {
  const url = new URL(`../../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}

test('tracked examples exercise the public-safe style and same-series contracts', async () => {
  const packetInput = await readJson(
    'fixtures/style_control/same_series/style-constraint-packet-input.example.json',
  );
  const reviewInput = await readJson(
    'fixtures/style_control/same_series/same-series-review.example.json',
  );

  const packet = compileStyleConstraintPacket(packetInput);
  const review = createSameSeriesReview(reviewInput);
  assert.equal(packet.maturity, 'EXPERIMENTAL');
  assert.equal(review.observationDecision.verdict, 'UNVERIFIED');
  assert.equal(review.observation.calibrationStatus, 'EXPERIMENTAL_UNCALIBRATED');

  const serialized = JSON.stringify({ packetInput, reviewInput });
  assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]/);
  assert.doesNotMatch(serialized, /(?:source|candidate|reference)Path/i);
});

test('the local Reflexive Visual Generation intake is protected from broad Git staging', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const privateImage = [
    'docs',
    'AI原生開源美術系統',
    'Reflexive_Visual_Generation_Series',
    'source',
    'private-derived.png',
  ].join('/');
  const result = spawnSync(
    'git',
    ['check-ignore', '--no-index', '--quiet', '--', privateImage],
    { cwd: repoRoot, windowsHide: true },
  );

  assert.equal(result.status, 0, result.stderr?.toString() || 'private intake is not ignored');
});
