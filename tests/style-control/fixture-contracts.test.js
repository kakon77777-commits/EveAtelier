import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
