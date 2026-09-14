import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createDemoWorkbenchRuntime } from '../../src/product-surface/demo-runtime.js';
import { createHumanWorkbenchHttpServer } from '../../src/product-surface/http-server.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'eve-v05-http-'));
  const runtime = await createDemoWorkbenchRuntime({ root });
  const host = createHumanWorkbenchHttpServer({ surface: runtime.surface });
  const listening = await host.listen();
  return { runtime, host, baseUrl: listening.baseUrl };
}

async function json(response) {
  const value = await response.json();
  assert.equal(response.headers.get('content-type').startsWith('application/json'), true);
  return value;
}

function rawJsonRequest(url, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('serves the local app, scoped workspace, and exact AssetStore bytes', async () => {
  const context = await setup();
  try {
    const page = await fetch(`${context.baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await page.text(), /data-surface="candidate-compare"/);

    const config = await json(await fetch(`${context.baseUrl}/api/config`));
    assert.equal(config.projectId, context.runtime.projectId);
    const workspace = await json(await fetch(
      `${context.baseUrl}/api/workspaces?projectId=${encodeURIComponent(config.projectId)}`
      + `&documentId=${encodeURIComponent(config.documentId)}`,
    ));
    const asset = await fetch(`${context.baseUrl}${workspace.canvas.asset.url}`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/png');
    assert.ok((await asset.arrayBuffer()).byteLength > 0);
    assert.equal((await fetch(`${context.baseUrl}/api/assets?projectId=x&documentId=y&assetId=z`)).status,
      404);
    assert.equal((await fetch(`${context.baseUrl}/../package.json`)).status, 404);
  } finally {
    await context.host.close();
    context.runtime.close();
  }
});

test('HTTP intent and review accept only bounded human commands', async () => {
  const context = await setup();
  try {
    const command = {
      projectId: context.runtime.projectId,
      documentId: context.runtime.documentId,
      text: '把背景去掉，邊緣不要有白邊。',
      taskTypeHint: 'UNKNOWN',
      roleBindingIds: [],
      preferences: [],
      hardConstraints: [],
      overrides: [],
      retrievalContextRefs: [],
    };
    const invalid = await fetch(`${context.baseUrl}/api/intents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...command, modelId: 'forbidden' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await json(invalid)).error, 'human_surface_intent_command_invalid');

    const started = await json(await fetch(`${context.baseUrl}/api/intents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    }));
    assert.equal(started.session.status, 'WAITING_HUMAN');
    const reviewed = await json(await fetch(`${context.baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: context.runtime.projectId,
        documentId: context.runtime.documentId,
        sessionId: started.session.session.sessionId,
        decision: 'APPROVE',
        reason: 'Approved through the bounded HTTP surface.',
      }),
    }));
    assert.equal(reviewed.session.terminalOutcome, 'ACCEPTED');
  } finally {
    await context.host.close();
    context.runtime.close();
  }
});

test('forged Host or Origin cannot reach surface commands or create a session', async () => {
  const context = await setup();
  try {
    const command = {
      projectId: context.runtime.projectId,
      documentId: context.runtime.documentId,
      text: '把背景去掉，邊緣不要有白邊。',
      taskTypeHint: 'UNKNOWN',
      roleBindingIds: [],
      preferences: [],
      hardConstraints: [],
      overrides: [],
      retrievalContextRefs: [],
    };
    const forgedHost = await rawJsonRequest(`${context.baseUrl}/api/intents`, {
      method: 'POST',
      headers: {
        host: 'evil.example',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(JSON.stringify(command)),
      },
      body: JSON.stringify(command),
    });
    assert.equal(forgedHost.status, 421);
    assert.equal(forgedHost.body.error, 'human_surface_host_forbidden');

    const forgedOrigin = await fetch(`${context.baseUrl}/api/intents`, {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
    });
    assert.equal(forgedOrigin.status, 403);
    assert.equal((await json(forgedOrigin)).error, 'human_surface_origin_forbidden');
    assert.deepEqual(context.runtime.visualIntelligenceStore.listSessions({
      projectId: context.runtime.projectId,
      documentId: context.runtime.documentId,
    }), []);
  } finally {
    await context.host.close();
    context.runtime.close();
  }
});

test('server refuses non-loopback binding and oversized or wrong-content requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eve-v05-http-boundary-'));
  const runtime = await createDemoWorkbenchRuntime({ root });
  try {
    assert.throws(() => createHumanWorkbenchHttpServer({
      surface: runtime.surface,
      host: '0.0.0.0',
    }), /human_surface_loopback_required/);
    const server = createHumanWorkbenchHttpServer({ surface: runtime.surface, maxBodyBytes: 64 });
    const { baseUrl } = await server.listen();
    try {
      const wrongType = await fetch(`${baseUrl}/api/intents`, {
        method: 'POST', body: '{}',
      });
      assert.equal(wrongType.status, 415);
      const oversized = await fetch(`${baseUrl}/api/intents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(200) }),
      });
      assert.equal(oversized.status, 413);
    } finally {
      await server.close();
    }
  } finally {
    runtime.close();
  }
});
