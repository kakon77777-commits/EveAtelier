const requiredCapabilityKeys = [
  'schema', 'mrmicVersion', 'canvasSchemaVersion', 'mcpProtocolProfile',
  'projectionModes', 'authModes', 'resourcePortal', 'runtimePresence', 'livePortalHost',
];

export function validateMrmicCapabilities(value) {
  const invalid = () => { throw new Error('mrmic_capabilities_invalid'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).some(key => !requiredCapabilityKeys.includes(key))) invalid();
  for (const key of requiredCapabilityKeys) if (!(key in value)) invalid();
  if (value.schema !== 'mrmic-capabilities/v1') invalid();
  if (typeof value.mrmicVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.mrmicVersion)) invalid();
  if (typeof value.canvasSchemaVersion !== 'string' || value.canvasSchemaVersion.length === 0) invalid();
  if (!value.mcpProtocolProfile || typeof value.mcpProtocolProfile.protocolVersion !== 'string' || typeof value.mcpProtocolProfile.profile !== 'string') invalid();
  if (!Array.isArray(value.projectionModes) || !Array.isArray(value.authModes)) invalid();
  if (!value.resourcePortal || typeof value.resourcePortal.supported !== 'boolean' || typeof value.resourcePortal.schemaVersion !== 'string') invalid();
  if (!value.runtimePresence || typeof value.runtimePresence.supported !== 'boolean' || typeof value.runtimePresence.schemaVersion !== 'string' || typeof value.runtimePresence.durable !== 'boolean') invalid();
  if (!value.livePortalHost || typeof value.livePortalHost.supported !== 'boolean' || typeof value.livePortalHost.stateVersion !== 'string') invalid();
  return value;
}

export class MrmicClient {
  constructor({ baseUrl = 'http://127.0.0.1:4173', timeoutMs = 1500 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async probeCapabilities() {
    const response = await fetch(`${this.baseUrl}/api/capabilities`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`mrmic_http_${response.status}`);
    return validateMrmicCapabilities(await response.json());
  }
}

export function assertFreshRevision({ expectedRevision, currentRevision }) {
  if (!Number.isInteger(expectedRevision) || !Number.isInteger(currentRevision)) {
    throw new TypeError('revision_must_be_integer');
  }
  if (expectedRevision !== currentRevision) {
    const error = new Error(`stale_input:${expectedRevision}->${currentRevision}`);
    error.code = 'STALE_INPUT';
    throw error;
  }
}

export function buildArtResourcePortal({
  id,
  canvasId,
  workspaceId,
  providerResourceId,
  createdBy,
  now = new Date().toISOString(),
  revision = 0,
  transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  style = {},
  displayMode = 'snapshot',
  interactionMode = 'view',
} = {}) {
  for (const [name, value] of Object.entries({ id, canvasId, workspaceId, providerResourceId })) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name}_required`);
  }
  if (!createdBy || typeof createdBy !== 'object') throw new TypeError('createdBy_required');
  if (!Number.isInteger(revision) || revision < 0) throw new TypeError('revision_invalid');

  return {
    id,
    canvasId,
    type: 'resource_portal',
    transform,
    style,
    childIds: [],
    bindings: {},
    metadata: {
      portalSchema: 'native_resource_portal_v1',
      portal: {
        portalId: id,
        pmwWorkspaceId: workspaceId,
        provider: 'external',
        resourceKind: 'artifact',
        providerResourceId,
        displayMode,
        interactionMode,
      },
      authority: 'external_asset_store',
      ownershipTransferred: false,
    },
    createdBy,
    createdAt: now,
    updatedAt: now,
    revision,
  };
}
