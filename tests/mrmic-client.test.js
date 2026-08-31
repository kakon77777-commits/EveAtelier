import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  MrmicClient,
  buildArtResourcePortal,
  buildCreatePortalTransaction,
  buildPatchPortalTransaction,
  assertFreshRevision,
  validateMrmicCapabilities,
} from '../src/mrmic-client.js';

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const validCapabilities = {
  schema: 'mrmic-capabilities/v1',
  mrmicVersion: '0.14.0',
  canvasSchemaVersion: '1',
  mcpProtocolProfile: { protocolVersion: '2025-11-25', profile: 'stateful_subset' },
  projectionModes: ['snapshot', 'live'],
  authModes: ['legacy_local', 'bearer_principal_v1'],
  resourcePortal: { supported: true, schemaVersion: 'native_resource_portal_v1' },
  runtimePresence: { supported: true, schemaVersion: 'ephemeral_runtime_presence_v1', durable: false },
  livePortalHost: { supported: true, stateVersion: 'live_portal_host_v1' },
};

test('MRMIC client accepts the published v1 capability shape from /api/capabilities', async () => {
  await withServer((req, res) => {
    if (req.url === '/api/capabilities') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(validCapabilities));
      return;
    }
    res.statusCode = 404;
    res.end();
  }, async baseUrl => {
    const client = new MrmicClient({ baseUrl });
    const capabilities = await client.probeCapabilities();
    assert.equal(capabilities.schema, 'mrmic-capabilities/v1');
    assert.equal(capabilities.resourcePortal.schemaVersion, 'native_resource_portal_v1');
  });
});

test('MRMIC capability validation fails closed when the portal capability is malformed', () => {
  const malformed = structuredClone(validCapabilities);
  delete malformed.resourcePortal.schemaVersion;
  assert.throws(() => validateMrmicCapabilities(malformed), /mrmic_capabilities_invalid/);
});

test('art resource portal maps an external art version without transferring provider ownership', () => {
  const portal = buildArtResourcePortal({
    id: 'portal:character-1001-v8',
    canvasId: 'canvas-root',
    workspaceId: 'pmw:atelier',
    providerResourceId: 'artasset://project/wanxiang/document/character-1001/version/8',
    createdBy: { actorType: 'system', actorId: 'eve-atelier' },
    now: '2026-08-30T10:00:00.000Z',
    revision: 3,
  });

  assert.equal(portal.type, 'resource_portal');
  assert.equal(portal.metadata.portalSchema, 'native_resource_portal_v1');
  assert.equal(portal.metadata.portal.provider, 'external');
  assert.equal(portal.metadata.portal.resourceKind, 'artifact');
  assert.equal(portal.metadata.portal.providerResourceId, 'artasset://project/wanxiang/document/character-1001/version/8');
  assert.equal(portal.metadata.authority, 'external_asset_store');
  assert.equal(portal.metadata.ownershipTransferred, false);
  assert.deepEqual(portal.bindings, []);
  assert.deepEqual(portal.transform, {
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: 0,
  });
  assert.equal(portal.metadata.portal.interactionMode, 'read_only');
});

test('revision guard rejects stale workbench inputs before any MRMIC mutation is prepared', () => {
  assert.doesNotThrow(() => assertFreshRevision({ expectedRevision: 42, currentRevision: 42 }));
  assert.throws(
    () => assertFreshRevision({ expectedRevision: 41, currentRevision: 42 }),
    error => error?.code === 'STALE_INPUT',
  );
});

test('MRMIC client creates and patches an external artifact portal with readback', async () => {
  let canvasRevision = 0;
  const objects = [];
  let postCount = 0;
  const bearerToken = 'test-bearer-token';

  await withServer((request, response) => {
    if (request.method === 'GET' && request.url === '/api/capabilities') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(validCapabilities));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/state')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        workspace: {
          id: 'workspace:test',
          title: 'Test workspace',
          rootCanvasId: 'canvas-root',
          schemaVersion: '0.14.0',
        },
        canvas: {
          id: 'canvas-root',
          workspaceId: 'workspace:test',
          title: 'Root canvas',
          objectIds: objects.map(object => object.id),
          revision: canvasRevision,
        },
        viewport: { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
        objects,
        eventCount: postCount,
        sync: { roomId: 'room:test', updates: postCount, peers: 0 },
        renderUri: '/api/render.svg?canvasId=canvas-root',
        lab: { trajectoryLength: 0 },
      }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/transaction') {
      postCount += 1;
      assert.equal(request.headers.authorization, `Bearer ${bearerToken}`);
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        assert.equal(body.includes(bearerToken), false);
        const transaction = JSON.parse(body);
        assert.equal(transaction.preconditions[0].expected, canvasRevision);
        for (const operation of transaction.operations) {
          if (operation.op === 'create_object') {
            objects.push(structuredClone(operation.object));
          } else if (operation.op === 'patch_object') {
            const object = objects.find(item => item.id === operation.objectId);
            assert.equal(operation.expectedRevision, object.revision);
            Object.assign(object, structuredClone(operation.patch));
            object.revision += 1;
          }
        }
        canvasRevision += 1;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ status: 'applied', canvasRevision }));
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  }, async baseUrl => {
    const client = new MrmicClient({ baseUrl });
    const actor = { actorType: 'user', actorId: 'eve-atelier-owner' };
    const candidatePortal = buildArtResourcePortal({
      id: 'portal:character-001',
      canvasId: 'canvas-root',
      workspaceId: 'workspace:test',
      providerResourceId: 'artasset://character-001/candidate/1',
      createdBy: actor,
      now: '2026-08-30T14:00:00.000Z',
      revision: 0,
    });
    const createTransaction = buildCreatePortalTransaction({
      portal: candidatePortal,
      canvasRevision: 0,
      actor,
      now: '2026-08-30T14:00:00.000Z',
      idempotencyKey: 'eve:create:character-001',
    });
    assert.equal(createTransaction.operations[0].op, 'create_object');

    const projected = await client.projectPortal({
      portal: candidatePortal,
      expectedCanvasRevision: 0,
      actor,
      bearerToken,
      idempotencyKey: 'eve:create:character-001',
      now: '2026-08-30T14:00:00.000Z',
    });
    assert.equal(
      projected.portal.metadata.portal.providerResourceId,
      'artasset://character-001/candidate/1',
    );

    const state = await client.getState();
    const patchTransaction = buildPatchPortalTransaction({
      currentPortal: state.objects[0],
      providerResourceId: 'artasset://character-001/promoted/1',
      canvasRevision: state.canvas.revision,
      actor,
      now: '2026-08-30T14:01:00.000Z',
      idempotencyKey: 'eve:promote:character-001',
    });
    assert.equal(patchTransaction.operations[0].op, 'patch_object');

    const promoted = await client.patchPortal({
      canvasId: 'canvas-root',
      portalId: candidatePortal.id,
      providerResourceId: 'artasset://character-001/promoted/1',
      expectedCanvasRevision: state.canvas.revision,
      actor,
      bearerToken,
      idempotencyKey: 'eve:promote:character-001',
      now: '2026-08-30T14:01:00.000Z',
    });
    assert.equal(
      promoted.portal.metadata.portal.providerResourceId,
      'artasset://character-001/promoted/1',
    );
    assert.equal(promoted.portal.metadata.ownershipTransferred, false);
  });

  assert.equal(postCount, 2);
});

test('live projection rejects a stale canvas revision before mutation dispatch', async () => {
  let postCount = 0;
  await withServer((request, response) => {
    if (request.method === 'GET' && request.url === '/api/capabilities') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(validCapabilities));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/state')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        workspace: { id: 'workspace:test' },
        canvas: { id: 'canvas-root', revision: 5 },
        objects: [],
      }));
      return;
    }
    if (request.method === 'POST') postCount += 1;
    response.statusCode = 404;
    response.end();
  }, async baseUrl => {
    const actor = { actorType: 'user', actorId: 'eve-atelier-owner' };
    const portal = buildArtResourcePortal({
      id: 'portal:stale',
      canvasId: 'canvas-root',
      workspaceId: 'workspace:test',
      providerResourceId: 'artasset://stale/candidate',
      createdBy: actor,
      revision: 0,
    });
    await assert.rejects(
      () => new MrmicClient({ baseUrl }).projectPortal({
        portal,
        expectedCanvasRevision: 4,
        actor,
        idempotencyKey: 'eve:stale',
      }),
      error => error?.code === 'STALE_INPUT',
    );
  });
  assert.equal(postCount, 0);
});
