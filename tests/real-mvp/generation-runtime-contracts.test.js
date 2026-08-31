import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileComfyWorkflow } from '../../src/providers/comfyui-workflow.js';
import { ComfyUiProvider } from '../../src/providers/comfyui-provider.js';
import { DiffusersProvider } from '../../src/providers/diffusers-provider.js';

const workflow = {
  '1': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
  '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old positive' } },
  '3': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' } },
  '4': { class_type: 'KSampler', inputs: { seed: 1 } },
  '5': { class_type: 'SaveImage', inputs: { filename_prefix: 'old' } },
  '6': { class_type: 'PreviewImage', inputs: {} },
};

const bindings = {
  sourceImage: { nodeId: '1', input: 'image' },
  positivePrompt: { nodeId: '2', input: 'text' },
  negativePrompt: { nodeId: '3', input: 'text' },
  seed: { nodeId: '4', input: 'seed' },
  filenamePrefix: { nodeId: '5', input: 'filename_prefix' },
};

function generationRequest({ sourcePath, outputPath }) {
  return {
    operationId: 'character-remaster-001:candidate:1',
    operatorId: 'visual.op.generative.generate_variation',
    source: { path: sourcePath, sha256: 'a'.repeat(64), bytes: 32 },
    references: [],
    intentText: ['Preserve identity', 'Low-saturation wuxia portrait'],
    constraints: { candidateCount: 2, humanReviewRequired: true },
    negativePrompt: 'homogenized face',
    seed: 77,
    outputPath,
  };
}

async function withServer(handler, operation) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await operation(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('compiles provider bindings into a cloned ComfyUI workflow', () => {
  const original = structuredClone(workflow);
  const compiled = compileComfyWorkflow({
    workflow,
    bindings,
    request: {
      sourceImageName: 'eve/source-upload.png',
      intentText: ['clean line work', 'low saturation'],
      negativePrompt: 'bad face',
      seed: 93,
      filenamePrefix: 'eve/task-001',
    },
  });

  assert.equal(compiled['1'].inputs.image, 'eve/source-upload.png');
  assert.equal(compiled['2'].inputs.text, 'clean line work\nlow saturation');
  assert.equal(compiled['3'].inputs.text, 'bad face');
  assert.equal(compiled['4'].inputs.seed, 93);
  assert.equal(compiled['5'].inputs.filename_prefix, 'eve/task-001');
  assert.deepEqual(workflow, original);
});

test('tracked SD1.5 image-to-image workflow compiles into core ComfyUI nodes', async () => {
  const trackedWorkflow = JSON.parse(await readFile(
    'fixtures/real_mvp/character_remaster/provider/comfyui-sd15-img2img-api.json',
    'utf8',
  ));
  const compiled = compileComfyWorkflow({
    workflow: trackedWorkflow,
    bindings: {
      sourceImage: { nodeId: '2', input: 'image' },
      positivePrompt: { nodeId: '3', input: 'text' },
      negativePrompt: { nodeId: '4', input: 'text' },
      seed: { nodeId: '6', input: 'seed' },
      filenamePrefix: { nodeId: '8', input: 'filename_prefix' },
    },
    request: {
      sourceImageName: 'eve/source.png',
      intentText: ['preserve identity', 'low-saturation wuxia'],
      negativePrompt: 'homogenized face',
      seed: 41001,
      filenamePrefix: 'eve/character-remaster-001',
    },
  });

  assert.equal(compiled['1'].class_type, 'CheckpointLoaderSimple');
  assert.equal(compiled['1'].inputs.ckpt_name, 'v1-5-pruned-emaonly.safetensors');
  assert.equal(compiled['2'].class_type, 'LoadImage');
  assert.equal(compiled['2'].inputs.image, 'eve/source.png');
  assert.deepEqual(compiled['5'].inputs.pixels, ['2', 0]);
  assert.deepEqual(compiled['6'].inputs.latent_image, ['5', 0]);
  assert.equal(compiled['6'].inputs.denoise, 0.38);
  assert.equal(compiled['6'].inputs.seed, 41001);
  assert.deepEqual(compiled['7'].inputs.samples, ['6', 0]);
  assert.equal(compiled['8'].class_type, 'SaveImage');
  assert.equal(compiled['8'].inputs.filename_prefix, 'eve/character-remaster-001');
});

test('tracked localized inpaint workflow composites repaired pixels over the unchanged parent', async () => {
  const trackedWorkflow = JSON.parse(await readFile(
    'fixtures/real_mvp/character_remaster/provider/comfyui-sd15-localized-inpaint-api.json',
    'utf8',
  ));
  const compiled = compileComfyWorkflow({
    workflow: trackedWorkflow,
    bindings: {
      sourceImage: { nodeId: '2', input: 'image' },
      maskImage: { nodeId: '3', input: 'image' },
      positivePrompt: { nodeId: '4', input: 'text' },
      negativePrompt: { nodeId: '5', input: 'text' },
      seed: { nodeId: '7', input: 'seed' },
      filenamePrefix: { nodeId: '10', input: 'filename_prefix' },
    },
    request: {
      sourceImageName: 'eve/parent.png',
      maskImageName: 'eve/mask.png',
      intentText: ['repair ornate metal, embroidery, and hand anatomy'],
      negativePrompt: 'identity drift',
      seed: 42001,
      filenamePrefix: 'eve/localized-repair-001',
    },
  });

  assert.equal(compiled['2'].inputs.image, 'eve/parent.png');
  assert.equal(compiled['3'].class_type, 'LoadImageMask');
  assert.equal(compiled['3'].inputs.image, 'eve/mask.png');
  assert.equal(compiled['6'].class_type, 'VAEEncode');
  assert.deepEqual(compiled['6'].inputs.pixels, ['2', 0]);
  assert.equal(compiled['11'].class_type, 'SetLatentNoiseMask');
  assert.deepEqual(compiled['11'].inputs.samples, ['6', 0]);
  assert.deepEqual(compiled['11'].inputs.mask, ['3', 0]);
  assert.deepEqual(compiled['7'].inputs.latent_image, ['11', 0]);
  assert.equal(compiled['7'].inputs.denoise, 0.20);
  assert.equal(compiled['7'].inputs.seed, 42001);
  assert.deepEqual(compiled['9'].inputs.destination, ['2', 0]);
  assert.deepEqual(compiled['9'].inputs.source, ['8', 0]);
  assert.deepEqual(compiled['9'].inputs.mask, ['3', 0]);
  assert.deepEqual(compiled['10'].inputs.images, ['9', 0]);
  assert.equal(compiled['10'].inputs.filename_prefix, 'eve/localized-repair-001');
});

test('ComfyUI real variation retrieves the configured output artifact exactly once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-comfy-runtime-'));
  const sourcePath = join(directory, 'source.png');
  const outputPath = join(directory, 'candidate.png');
  await writeFile(sourcePath, 'source-image-bytes');
  let submitted;
  let uploadCount = 0;
  let promptCount = 0;

  await withServer((request, response) => {
    if (request.method === 'POST' && request.url === '/upload/image') {
      uploadCount += 1;
      assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/);
      request.resume();
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ name: 'source-upload.png', subfolder: 'eve', type: 'input' }));
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/prompt') {
      promptCount += 1;
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        submitted = JSON.parse(body);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ prompt_id: 'prompt-1', number: 1 }));
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/history/prompt-1') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        'prompt-1': {
          status: { status_str: 'success', completed: true },
          outputs: {
            '6': {
              images: [{ filename: 'candidate.png', subfolder: 'eve', type: 'output' }],
            },
          },
        },
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/view?filename=candidate.png&subfolder=eve&type=output') {
      response.setHeader('content-type', 'image/png');
      response.end(Buffer.from('real-provider-image-bytes'));
      return;
    }
    response.statusCode = 404;
    response.end();
  }, async baseUrl => {
    const provider = new ComfyUiProvider({
      baseUrl,
      workflow,
      bindings,
      outputNodeId: '6',
      modelIdentity: { id: 'checkpoint:test', revision: 'sha256:test' },
      clientId: 'eve-real-mvp',
      pollIntervalMs: 0,
      maxWaitMs: 1000,
      sleep: async () => {},
    });
    const result = await provider.generateVariation(generationRequest({ sourcePath, outputPath }));
    assert.equal(result.status, 'completed');
    assert.equal(result.mode, 'real');
    assert.equal(result.executionId, 'prompt-1');
    assert.deepEqual(result.modelIdentity, { id: 'checkpoint:test', revision: 'sha256:test' });
    assert.match(result.parameterDigest, /^[a-f0-9]{64}$/);
  });

  assert.equal(uploadCount, 1);
  assert.equal(promptCount, 1);
  assert.equal(submitted.client_id, 'eve-real-mvp');
  assert.equal(submitted.prompt['1'].inputs.image, 'eve/source-upload.png');
  assert.equal(submitted.prompt['4'].inputs.seed, 77);
  assert.deepEqual(await readFile(outputPath), Buffer.from('real-provider-image-bytes'));
});

test('ComfyUI localized repair uploads and binds one explicit mask', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-comfy-localized-'));
  const sourcePath = join(directory, 'parent.png');
  const maskPath = join(directory, 'repair-mask.png');
  const outputPath = join(directory, 'repair.png');
  await writeFile(sourcePath, 'parent-image-bytes');
  await writeFile(maskPath, 'mask-image-bytes');
  let submitted;
  let uploadCount = 0;

  await withServer((request, response) => {
    if (request.method === 'POST' && request.url === '/upload/image') {
      uploadCount += 1;
      request.resume();
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          name: uploadCount === 1 ? 'parent-upload.png' : 'mask-upload.png',
          subfolder: 'eve',
          type: 'input',
        }));
      });
      return;
    }
    if (request.method === 'POST' && request.url === '/prompt') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        submitted = JSON.parse(body);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ prompt_id: 'repair-prompt-1', number: 2 }));
      });
      return;
    }
    if (request.method === 'GET' && request.url === '/history/repair-prompt-1') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        'repair-prompt-1': {
          status: { status_str: 'success', completed: true },
          outputs: {
            '6': {
              images: [{ filename: 'repair.png', subfolder: 'eve', type: 'output' }],
            },
          },
        },
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/view?filename=repair.png&subfolder=eve&type=output') {
      response.setHeader('content-type', 'image/png');
      response.end(Buffer.from('localized-repair-image-bytes'));
      return;
    }
    response.statusCode = 404;
    response.end();
  }, async baseUrl => {
    const repairWorkflow = structuredClone(workflow);
    repairWorkflow['7'] = { class_type: 'LoadImageMask', inputs: { image: 'old-mask.png', channel: 'red' } };
    const provider = new ComfyUiProvider({
      baseUrl,
      workflow: repairWorkflow,
      bindings: {
        ...bindings,
        maskImage: { nodeId: '7', input: 'image' },
      },
      outputNodeId: '6',
      modelIdentity: { id: 'checkpoint:test', revision: 'sha256:test' },
      clientId: 'eve-real-mvp',
      pollIntervalMs: 0,
      maxWaitMs: 1000,
      sleep: async () => {},
    });
    const request = generationRequest({ sourcePath, outputPath });
    request.operatorId = 'visual.op.generative.inpaint';
    request.mask = { path: maskPath, sha256: 'b'.repeat(64), bytes: 16 };
    const result = await provider.generateVariation(request);
    assert.equal(result.evidence.maskUpload.workflowName, 'eve/mask-upload.png');
  });

  assert.equal(uploadCount, 2);
  assert.equal(submitted.prompt['1'].inputs.image, 'eve/parent-upload.png');
  assert.equal(submitted.prompt['7'].inputs.image, 'eve/mask-upload.png');
  assert.deepEqual(await readFile(outputPath), Buffer.from('localized-repair-image-bytes'));
});

test('Diffusers variation requires an explicit local model and labels fixtures honestly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-diffusers-runtime-'));
  const sourcePath = join(directory, 'source.png');
  const outputPath = join(directory, 'candidate.png');
  const fixture = spawnSync('python3', ['tests/helpers/fixture-image.py', sourcePath, 'subject'], {
    encoding: 'utf8',
  });
  assert.equal(fixture.status, 0, fixture.stderr);
  const request = generationRequest({ sourcePath, outputPath });

  await assert.rejects(
    () => new DiffusersProvider().generateVariation(request),
    /explicit_model_required/,
  );
  await assert.rejects(
    () => new DiffusersProvider({
      model: { modelId: 'model:not-cached', allowDownload: false },
      invoke: () => ({ status: 'unavailable', reason: 'model_not_available_locally' }),
    }).generateVariation(request),
    /model_not_available_locally/,
  );

  const result = await new DiffusersProvider({ fixture: true }).generateVariation(request);
  assert.equal(result.status, 'completed');
  assert.equal(result.mode, 'fixture');
  assert.deepEqual(result.modelIdentity, { id: 'fixture:deterministic-raster', revision: '0.1' });
  assert.ok((await readFile(outputPath)).length > 0);
});
