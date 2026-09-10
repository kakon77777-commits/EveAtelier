import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function finiteArray(value, length) {
  return Array.isArray(value)
    && value.length === length
    && value.every(Number.isFinite);
}

function byte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeBlend(value) {
  const allowed = new Set([
    'over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colour-dodge',
    'colour-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'add',
    'saturate', 'dest-in', 'dest-out',
  ]);
  if (!allowed.has(value)) throw new Error(`sharp_blend_mode_unsupported:${value}`);
  return value;
}

const operatorCapabilities = Object.freeze([
  ['visual.op.raster.crop', 'raster.crop'],
  ['visual.op.raster.resize', 'raster.resize'],
  ['visual.op.raster.rotate', 'raster.rotate'],
  ['visual.op.raster.create_mask', 'raster.mask'],
  ['visual.op.raster.create_alpha', 'raster.alpha'],
  ['visual.op.raster.edge_cleanup', 'raster.edge_cleanup'],
  ['visual.op.raster.recolor', 'raster.recolor'],
  ['visual.op.composite.layer_composite', 'raster.layer_composite'],
  ['visual.op.raster.convert_format', 'raster.format'],
  ['visual.op.raster.basic_filter', 'raster.filter'],
]);

async function rawRgba(sharp, path) {
  return sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function rawGray(sharp, path, width, height) {
  const metadata = await sharp(path).metadata();
  if (metadata.width !== width || metadata.height !== height) {
    throw new Error(`sharp_mask_extent_mismatch:${metadata.width}x${metadata.height}->${width}x${height}`);
  }
  return sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
}

async function saveRgba(sharp, data, width, height, output) {
  await sharp(data, { raw: { width, height, channels: 4 } })
    .toColourspace('srgb').png().toFile(output);
}

async function operationMetadata(sharp, output, extra = {}) {
  const metadata = await sharp(output).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    colourspace: metadata.space,
    ...extra,
  };
}

async function applyAlphaControls(sharp, input, opacity, masks) {
  const value = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new Error('sharp_composite_opacity_invalid');
  }
  const resolvedMasks = [];
  for (const maskPath of masks) {
    if (typeof maskPath !== 'string' || !existsSync(maskPath)) {
      throw new Error('sharp_composite_mask_missing');
    }
    resolvedMasks.push(await rawGray(sharp, maskPath, value.info.width, value.info.height));
  }
  for (let index = 0; index < value.info.width * value.info.height; index += 1) {
    let alpha = value.data[(index * 4) + 3] * opacity;
    for (const mask of resolvedMasks) alpha *= mask.data[index] / 255;
    value.data[(index * 4) + 3] = byte(alpha);
  }
  return sharp(value.data, {
    raw: { width: value.info.width, height: value.info.height, channels: 4 },
  }).png().toBuffer();
}

async function renderStackItem(sharp, item, canvas) {
  if (!item || typeof item !== 'object' || Array.isArray(item)
      || !['GROUP', 'LAYER'].includes(item.kind)
      || typeof item.visible !== 'boolean'
      || typeof item.blend !== 'string'
      || !Array.isArray(item.masks)) {
    throw new Error('sharp_layer_stack_item_invalid');
  }
  if (!item.visible) return null;
  if (item.kind === 'LAYER') {
    if (typeof item.input !== 'string' || !existsSync(item.input)) {
      throw new Error('sharp_layer_stack_input_missing');
    }
    return {
      input: await applyAlphaControls(sharp, item.input, item.opacity, item.masks),
      blend: normalizeBlend(item.blend),
      left: 0,
      top: 0,
    };
  }
  if (!Array.isArray(item.children) || item.children.length === 0) {
    throw new Error('sharp_layer_group_empty');
  }
  let group = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
  for (const child of item.children) {
    const rendered = await renderStackItem(sharp, child, canvas);
    if (rendered === null) continue;
    group = await sharp(group).composite([rendered]).png().toBuffer();
  }
  return {
    input: await applyAlphaControls(sharp, group, item.opacity, item.masks),
    blend: normalizeBlend(item.blend),
    left: 0,
    top: 0,
  };
}

export class SharpRasterProvider {
  constructor({
    loadSharp = () => import('sharp'),
    now = () => new Date().toISOString(),
  } = {}) {
    this.loadSharp = loadSharp;
    this.now = now;
    this.providerId = 'provider:sharp-libvips';
    this.providerVersion = '0.35.4';
  }

  async #sharp() {
    const module = await this.loadSharp();
    return module.default ?? module;
  }

  async probe() {
    try {
      const sharp = await this.#sharp();
      const observed = sharp.versions?.sharp ?? null;
      if (observed !== this.providerVersion) {
        return {
          available: false,
          providerId: this.providerId,
          providerVersion: this.providerVersion,
          reason: 'sharp_version_mismatch',
          observedVersion: observed,
        };
      }
      return {
        available: true,
        providerId: this.providerId,
        providerVersion: this.providerVersion,
        runtime: { sharp: observed, libvips: sharp.versions?.vips ?? 'unknown' },
      };
    } catch (error) {
      return {
        available: false,
        providerId: this.providerId,
        providerVersion: this.providerVersion,
        reason: error?.code === 'ERR_MODULE_NOT_FOUND' ? 'sharp_not_installed' : 'sharp_load_failed',
      };
    }
  }

  async capability() {
    const probe = await this.probe();
    return {
      schema: 'eve-atelier-provider-capability/v2',
      providerId: this.providerId,
      providerVersion: this.providerVersion,
      availability: probe.available ? 'AVAILABLE' : 'UNAVAILABLE',
      privacy: 'LOCAL',
      runtime: {
        kind: 'NODE_LIBRARY',
        name: 'sharp/libvips',
        version: probe.available
          ? `${probe.runtime.sharp}+libvips-${probe.runtime.libvips}`
          : this.providerVersion,
      },
      license: { spdx: 'Apache-2.0 AND LGPL-3.0-or-later', boundary: 'LIBRARY' },
      lastVerifiedAt: this.now(),
      maxWidth: 16384,
      maxHeight: 16384,
      inputKinds: ['raster.image'],
      outputKinds: ['raster.image', 'raster.mask'],
      localities: ['GLOBAL', 'REGIONAL'],
      determinism: 'DETERMINISTIC',
      reproducibility: 'EXACT',
      supports: {
        alpha: true,
        layers: true,
        structure: false,
        references: false,
        seed: false,
        batch: false,
      },
      capabilities: operatorCapabilities.map(([, capability]) => capability),
      operators: operatorCapabilities.map(([operatorId]) => ({
        operatorId,
        versions: ['1.0.0'],
        evidenceLevel: 'CONTRACT_TESTED',
        costRank: 1,
        latencyRank: 1,
      })),
    };
  }

  async execute(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('sharp_request_required');
    }
    if (typeof request.input !== 'string'
        || typeof request.output !== 'string'
        || typeof request.operatorId !== 'string'
        || !request.params
        || typeof request.params !== 'object'
        || Array.isArray(request.params)) {
      throw new Error('sharp_request_invalid');
    }
    if (!existsSync(request.input)) throw new Error('sharp_input_missing');
    if (existsSync(request.output)) throw new Error('sharp_output_must_not_exist');
    const sharp = await this.#sharp();
    const p = request.params;
    let metadata;
    switch (request.operatorId) {
      case 'visual.op.raster.crop': {
        await sharp(request.input).extract({
          left: p.left, top: p.top, width: p.width, height: p.height,
        }).keepMetadata().toFile(request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      case 'visual.op.raster.resize': {
        await sharp(request.input).resize(p.width, p.height, { fit: p.fit ?? 'fill' })
          .keepMetadata().toFile(request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      case 'visual.op.raster.rotate': {
        await sharp(request.input).rotate(p.angle, {
          background: p.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
        }).keepMetadata().toFile(request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      case 'visual.op.raster.create_mask': {
        if (!finiteArray(p.background, 3) || !Number.isFinite(p.tolerance)) {
          throw new Error('sharp_create_mask_params_invalid');
        }
        const { data, info } = await rawRgba(sharp, request.input);
        const mask = Buffer.alloc(info.width * info.height);
        for (let index = 0; index < mask.length; index += 1) {
          const offset = index * 4;
          const dr = data[offset] - p.background[0];
          const dg = data[offset + 1] - p.background[1];
          const db = data[offset + 2] - p.background[2];
          mask[index] = Math.sqrt((dr * dr) + (dg * dg) + (db * db)) <= p.tolerance
            ? 0
            : 255;
        }
        await sharp(mask, { raw: { width: info.width, height: info.height, channels: 1 } })
          .toColourspace('b-w').png().toFile(request.output);
        metadata = await operationMetadata(sharp, request.output, { mask: true });
        break;
      }
      case 'visual.op.raster.create_alpha': {
        if (typeof p.mask !== 'string' || !existsSync(p.mask)) {
          throw new Error('sharp_alpha_mask_missing');
        }
        const { data, info } = await rawRgba(sharp, request.input);
        const mask = await rawGray(sharp, p.mask, info.width, info.height);
        for (let index = 0; index < info.width * info.height; index += 1) {
          data[(index * 4) + 3] = mask.data[index];
        }
        await saveRgba(sharp, data, info.width, info.height, request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      case 'visual.op.raster.edge_cleanup': {
        const radius = p.radius ?? 1;
        if (!Number.isSafeInteger(radius) || radius < 0 || radius > 32) {
          throw new Error('sharp_edge_radius_invalid');
        }
        const { data, info } = await rawRgba(sharp, request.input);
        if (typeof p.mask !== 'string' || !existsSync(p.mask)) {
          throw new Error('sharp_edge_mask_missing');
        }
        const localityMask = await rawGray(sharp, p.mask, info.width, info.height);
        if (radius > 0) {
          const source = Buffer.from(data);
          for (let y = 0; y < info.height; y += 1) {
            for (let x = 0; x < info.width; x += 1) {
              let minimum = 255;
              for (let dy = -radius; dy <= radius; dy += 1) {
                const yy = Math.max(0, Math.min(info.height - 1, y + dy));
                for (let dx = -radius; dx <= radius; dx += 1) {
                  const xx = Math.max(0, Math.min(info.width - 1, x + dx));
                  minimum = Math.min(minimum, source[((yy * info.width) + xx) * 4 + 3]);
                }
              }
              const pixel = (y * info.width) + x;
              if (localityMask.data[pixel] > 0) data[(pixel * 4) + 3] = minimum;
            }
          }
        }
        await saveRgba(sharp, data, info.width, info.height, request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      case 'visual.op.raster.recolor': {
        if (!finiteArray(p.tint, 3)) throw new Error('sharp_recolor_tint_invalid');
        const { data, info } = await rawRgba(sharp, request.input);
        for (let index = 0; index < info.width * info.height; index += 1) {
          const offset = index * 4;
          data[offset] = byte(data[offset] * p.tint[0]);
          data[offset + 1] = byte(data[offset + 1] * p.tint[1]);
          data[offset + 2] = byte(data[offset + 2] * p.tint[2]);
        }
        await saveRgba(sharp, data, info.width, info.height, request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      case 'visual.op.composite.layer_composite': {
        const baseMetadata = await sharp(request.input).metadata();
        const canvas = { width: baseMetadata.width, height: baseMetadata.height };
        const composites = [];
        if (p.stack !== undefined) {
          if (!Array.isArray(p.stack) || p.stack.length === 0 || p.overlay !== undefined) {
            throw new Error('sharp_layer_stack_invalid');
          }
          for (const item of p.stack) {
            const rendered = await renderStackItem(sharp, item, canvas);
            if (rendered !== null) composites.push(rendered);
          }
        } else {
          if (typeof p.overlay !== 'string' || !existsSync(p.overlay)) {
            throw new Error('sharp_composite_overlay_missing');
          }
          composites.push({
            input: await applyAlphaControls(
              sharp,
              p.overlay,
              p.opacity ?? 1,
              p.mask === undefined ? [] : [p.mask],
            ),
            left: p.left ?? 0,
            top: p.top ?? 0,
            blend: normalizeBlend(p.blend ?? 'over'),
          });
        }
        if (composites.length === 0) throw new Error('sharp_layer_stack_empty_render');
        await sharp(request.input).ensureAlpha().composite(composites)
          .keepMetadata().png().toFile(request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      case 'visual.op.raster.convert_format': {
        const format = p.format;
        if (!['png', 'jpeg', 'webp', 'tiff'].includes(format)) {
          throw new Error('sharp_format_unsupported');
        }
        const options = p.quality === undefined ? {} : { quality: p.quality };
        await sharp(request.input).keepMetadata().toFormat(format, options).toFile(request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      case 'visual.op.raster.basic_filter': {
        let pipeline = sharp(request.input);
        if (p.filter === 'BLUR') pipeline = pipeline.blur(p.amount);
        else if (p.filter === 'SHARPEN') pipeline = pipeline.sharpen({ sigma: p.amount });
        else if (p.filter === 'GRAYSCALE') pipeline = pipeline.grayscale();
        else throw new Error('sharp_filter_unsupported');
        if (p.colourspace !== undefined) pipeline = pipeline.toColourspace(p.colourspace);
        await pipeline.keepMetadata().toFile(request.output);
        metadata = await operationMetadata(sharp, request.output);
        break;
      }
      default:
        throw new Error(`sharp_operator_unsupported:${request.operatorId}`);
    }
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
      outputSha256: hash(request.output),
      metadata,
    };
  }
}
