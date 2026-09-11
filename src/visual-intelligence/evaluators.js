import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export async function evaluateBackgroundRemovalCandidate({ sourcePath, outputPath } = {}) {
  if (typeof sourcePath !== 'string' || typeof outputPath !== 'string') {
    throw new TypeError('aads_background_evaluator_paths_required');
  }
  const source = await sharp(sourcePath).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const output = await sharp(outputPath).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const sameDimensions = source.info.width === output.info.width
    && source.info.height === output.info.height;
  let transparentPixels = 0;
  let opaquePixels = 0;
  let partialAlphaPixels = 0;
  let whiteFringePixels = 0;
  let rgbChangedPixels = 0;
  if (sameDimensions) {
    for (let index = 0; index < source.info.width * source.info.height; index += 1) {
      const offset = index * 4;
      const alpha = output.data[offset + 3];
      if (alpha === 0) transparentPixels += 1;
      else if (alpha === 255) opaquePixels += 1;
      else partialAlphaPixels += 1;
      if (alpha > 0 && alpha < 255
          && output.data[offset] >= 240
          && output.data[offset + 1] >= 240
          && output.data[offset + 2] >= 240) whiteFringePixels += 1;
      if (source.data[offset] !== output.data[offset]
          || source.data[offset + 1] !== output.data[offset + 1]
          || source.data[offset + 2] !== output.data[offset + 2]) {
        rgbChangedPixels += 1;
      }
    }
  }
  const accepted = sameDimensions
    && transparentPixels > 0
    && opaquePixels > 0
    && whiteFringePixels === 0
    && rgbChangedPixels === 0;
  return {
    verdict: accepted ? 'ACCEPT' : 'REPAIR',
    width: output.info.width,
    height: output.info.height,
    sameDimensions,
    transparentPixels,
    opaquePixels,
    partialAlphaPixels,
    whiteFringePixels,
    rgbChangedPixels,
    rgbPreserved: rgbChangedPixels === 0,
    edgeConstraintSatisfied: whiteFringePixels === 0,
    sourceSha256: hash(sourcePath),
    outputSha256: hash(outputPath),
  };
}
