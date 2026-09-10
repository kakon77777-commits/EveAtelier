import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  compileStyleConstraintPacket,
  createSameSeriesReview,
} from '../../src/style-control/contracts.js';
import {
  CalibrationEvidenceStore,
  adaptSameSeriesObservation,
} from '../../src/style-control/calibration-store.js';

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

test('tracked dimension profile adapts the legacy example without changing its verdict', async () => {
  const profile = await readJson(
    'fixtures/style_control/same_series/dimension-profile.example.json',
  );
  const reviewInput = await readJson(
    'fixtures/style_control/same_series/same-series-review.example.json',
  );
  const store = new CalibrationEvidenceStore({ path: ':memory:' });
  try {
    const profileRef = store.registerProfile({
      profile,
      proposer: { kind: 'SYSTEM', id: 'system:synthetic-fixture-loader' },
      registeredAt: '2026-09-10T20:00:00+08:00',
    });
    const observation = adaptSameSeriesObservation({
      profile,
      relation: {
        kind: 'SAME_CHARACTER_EXACT_PAIR',
        leftCharacterRef: 'character:synthetic:fixture',
        rightCharacterRef: 'character:synthetic:fixture',
      },
      observation: reviewInput.observation,
    });

    assert.deepEqual(observation.profileRef, profileRef);
    assert.deepEqual(store.appendObservation(observation), observation);
    assert.equal(createSameSeriesReview(reviewInput).observationDecision.verdict, 'UNVERIFIED');
    assert.equal(store.summarizeEvidence({
      profileRef,
      scope: observation.scope,
    }).calibrationStatus, 'EXPERIMENTAL_UNCALIBRATED');

    const serialized = JSON.stringify({ profile, observation });
    assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]/);
  } finally {
    store.close();
  }
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
