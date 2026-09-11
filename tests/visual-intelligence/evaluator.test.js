import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { evaluateBackgroundRemovalCandidate } from '../../src/visual-intelligence/evaluators.js';
import { writeSubject } from '../art-domain/helpers.js';

async function writeCandidate(source, output, mutate) {
  const raw = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const data = Buffer.from(raw.data);
  for (let y = 0; y < raw.info.height; y += 1) {
    for (let x = 0; x < raw.info.width; x += 1) {
      if (x < 4 || x >= raw.info.width - 4 || y < 3 || y >= raw.info.height - 3) {
        data[((y * raw.info.width) + x) * 4 + 3] = 0;
      }
    }
  }
  mutate?.(data, raw.info);
  await sharp(data, {
    raw: { width: raw.info.width, height: raw.info.height, channels: 4 },
  }).png().toFile(output);
}

test('background evaluator requires alpha separation, exact RGB preservation, and no white fringe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v03-evaluator-'));
  const source = await writeSubject(join(root, 'source.png'));
  const acceptedPath = join(root, 'accepted.png');
  await writeCandidate(source, acceptedPath);
  const accepted = await evaluateBackgroundRemovalCandidate({
    sourcePath: source,
    outputPath: acceptedPath,
  });
  assert.equal(accepted.verdict, 'ACCEPT');
  assert.equal(accepted.rgbChangedPixels, 0);
  assert.equal(accepted.whiteFringePixels, 0);
  assert.ok(accepted.transparentPixels > 0);
  assert.ok(accepted.opaquePixels > 0);

  const changedPath = join(root, 'changed.png');
  await writeCandidate(source, changedPath, data => { data[(8 * 16 + 8) * 4] += 1; });
  const changed = await evaluateBackgroundRemovalCandidate({
    sourcePath: source,
    outputPath: changedPath,
  });
  assert.equal(changed.verdict, 'REPAIR');
  assert.equal(changed.rgbChangedPixels, 1);

  const fringePath = join(root, 'fringe.png');
  await writeCandidate(source, fringePath, data => { data[3] = 128; });
  const fringe = await evaluateBackgroundRemovalCandidate({
    sourcePath: source,
    outputPath: fringePath,
  });
  assert.equal(fringe.verdict, 'REPAIR');
  assert.equal(fringe.whiteFringePixels, 1);
});
