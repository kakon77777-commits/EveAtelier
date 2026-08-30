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
