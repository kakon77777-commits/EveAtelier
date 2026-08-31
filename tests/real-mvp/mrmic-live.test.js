import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MrmicClient, buildArtResourcePortal } from '../../src/mrmic-client.js';

const enabled = process.env.EVE_REAL_MVP === '1' && Boolean(process.env.EVE_MRMIC_URL);

test('projects candidate and promoted artifacts through a live MRMIC process', { skip: !enabled }, async () => {
  const client = new MrmicClient({ baseUrl: process.env.EVE_MRMIC_URL, timeoutMs: 5000 });
  const capabilities = await client.probeCapabilities();
  const initial = await client.getState();
  const suffix = randomUUID();
  const actor = { actorType: 'user', actorId: 'eve-atelier-local-owner' };
  const portal = buildArtResourcePortal({
    id: `portal:eve-atelier:${suffix}`,
    canvasId: initial.canvas.id,
    workspaceId: initial.workspace.id,
    providerResourceId: `artasset://eve-atelier/${suffix}/candidate`,
    createdBy: actor,
    revision: 0,
    transform: { x: 40, y: 40, width: 360, height: 220, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 30 },
  });
  const auth = process.env.EVE_MRMIC_TOKEN;

  const candidate = await client.projectPortal({
    portal,
    expectedCanvasRevision: initial.canvas.revision,
    actor,
    bearerToken: auth,
    idempotencyKey: `eve:create:${suffix}`,
  });
  assert.equal(candidate.portal.metadata.portal.providerResourceId, `artasset://eve-atelier/${suffix}/candidate`);

  const afterCandidate = await client.getState();
  const promoted = await client.patchPortal({
    canvasId: initial.canvas.id,
    portalId: portal.id,
    providerResourceId: `artasset://eve-atelier/${suffix}/promoted`,
    expectedCanvasRevision: afterCandidate.canvas.revision,
    actor,
    bearerToken: auth,
    idempotencyKey: `eve:promote:${suffix}`,
  });
  assert.equal(promoted.portal.metadata.portal.providerResourceId, `artasset://eve-atelier/${suffix}/promoted`);
  assert.equal(promoted.portal.metadata.ownershipTransferred, false);
  assert.equal(capabilities.resourcePortal.schemaVersion, 'native_resource_portal_v1');
});
