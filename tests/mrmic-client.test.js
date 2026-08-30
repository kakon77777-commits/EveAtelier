import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  MrmicClient,
  buildArtResourcePortal,
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
});

test('revision guard rejects stale workbench inputs before any MRMIC mutation is prepared', () => {
  assert.doesNotThrow(() => assertFreshRevision({ expectedRevision: 42, currentRevision: 42 }));
  assert.throws(
    () => assertFreshRevision({ expectedRevision: 41, currentRevision: 42 }),
    error => error?.code === 'STALE_INPUT',
  );
});
