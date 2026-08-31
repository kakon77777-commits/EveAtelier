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

  async #json(path, { method = 'GET', body, bearerToken } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      if (method === 'POST') {
        const error = new Error('mrmic_request_uncertain_after_dispatch', { cause });
        error.code = 'UNKNOWN_AFTER_DISPATCH';
        throw error;
      }
      throw cause;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error(payload?.error ?? `mrmic_http_${response.status}`);
      error.code = payload?.code ?? `MRMIC_HTTP_${response.status}`;
      throw error;
    }
    if (!payload || typeof payload !== 'object') throw new Error('mrmic_response_invalid');
    return payload;
  }

  async probeCapabilities() {
    return validateMrmicCapabilities(await this.#json('/api/capabilities'));
  }

  async getState({ canvasId } = {}) {
    const query = canvasId ? `?canvasId=${encodeURIComponent(canvasId)}` : '';
    const state = await this.#json(`/api/state${query}`);
    if (!state.canvas
        || typeof state.canvas.id !== 'string'
        || !Number.isInteger(state.canvas.revision)
        || !Array.isArray(state.objects)) {
      throw new Error('mrmic_state_invalid');
    }
    return state;
  }

  async submitTransaction({ transaction, bearerToken } = {}) {
    if (!transaction || typeof transaction !== 'object') throw new TypeError('mrmic_transaction_required');
    return this.#json('/api/transaction', { method: 'POST', body: transaction, bearerToken });
  }

  async verifyPortal({ canvasId, portalId, providerResourceId }) {
    const state = await this.getState({ canvasId });
    const portal = state.objects.find(object => object.id === portalId);
    if (!portal
        || portal.type !== 'resource_portal'
        || portal.metadata?.portalSchema !== 'native_resource_portal_v1'
        || portal.metadata?.portal?.provider !== 'external'
        || portal.metadata?.portal?.resourceKind !== 'artifact'
        || portal.metadata?.portal?.providerResourceId !== providerResourceId
        || portal.metadata?.ownershipTransferred !== false) {
      throw new Error('mrmic_portal_readback_mismatch');
    }
    return structuredClone(portal);
  }

  async projectPortal({
    portal,
    expectedCanvasRevision,
    actor,
    bearerToken,
    idempotencyKey,
    now = new Date().toISOString(),
  }) {
    assertPortalCapability(await this.probeCapabilities());
    const state = await this.getState({ canvasId: portal.canvasId });
    assertFreshRevision({ expectedRevision: expectedCanvasRevision, currentRevision: state.canvas.revision });
    const transaction = buildCreatePortalTransaction({
      portal,
      canvasRevision: state.canvas.revision,
      actor,
      now,
      idempotencyKey,
    });
    const result = await this.submitTransaction({ transaction, bearerToken });
    const verified = await this.verifyPortal({
      canvasId: portal.canvasId,
      portalId: portal.id,
      providerResourceId: portal.metadata.portal.providerResourceId,
    });
    return { transaction, result, portal: verified };
  }

  async patchPortal({
    canvasId,
    portalId,
    providerResourceId,
    expectedCanvasRevision,
    actor,
    bearerToken,
    idempotencyKey,
    now = new Date().toISOString(),
  }) {
    assertPortalCapability(await this.probeCapabilities());
    const state = await this.getState({ canvasId });
    assertFreshRevision({ expectedRevision: expectedCanvasRevision, currentRevision: state.canvas.revision });
    const currentPortal = state.objects.find(object => object.id === portalId);
    if (!currentPortal) throw new Error('mrmic_portal_not_found');
    const transaction = buildPatchPortalTransaction({
      currentPortal,
      providerResourceId,
      canvasRevision: state.canvas.revision,
      actor,
      now,
      idempotencyKey,
    });
    const result = await this.submitTransaction({ transaction, bearerToken });
    const verified = await this.verifyPortal({ canvasId, portalId, providerResourceId });
    return { transaction, result, portal: verified };
  }
}

function assertPortalCapability(capabilities) {
  if (capabilities.resourcePortal?.supported !== true
      || capabilities.resourcePortal.schemaVersion !== 'native_resource_portal_v1') {
    throw new Error('mrmic_resource_portal_unsupported');
  }
}

function transactionBase({ canvasId, canvasRevision, actor, now, idempotencyKey }) {
  if (typeof canvasId !== 'string' || canvasId.length === 0) throw new TypeError('canvas_id_required');
  if (!Number.isInteger(canvasRevision) || canvasRevision < 0) throw new TypeError('canvas_revision_invalid');
  if (!actor || typeof actor !== 'object') throw new TypeError('actor_required');
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    throw new TypeError('idempotency_key_required');
  }
  return {
    id: `transaction:${idempotencyKey}`,
    canvasId,
    actor: structuredClone(actor),
    preconditions: [{ type: 'canvas_revision', targetId: canvasId, expected: canvasRevision }],
    mode: 'direct',
    createdAt: now,
    idempotencyKey,
  };
}

export function buildCreatePortalTransaction({
  portal,
  canvasRevision,
  actor,
  now = new Date().toISOString(),
  idempotencyKey,
} = {}) {
  if (!portal || portal.type !== 'resource_portal') throw new TypeError('resource_portal_required');
  return {
    ...transactionBase({ canvasId: portal.canvasId, canvasRevision, actor, now, idempotencyKey }),
    intent: 'Project EveAtelier candidate artifact',
    expectedOutcome: 'Create one external artifact resource portal',
    operations: [{ op: 'create_object', object: structuredClone(portal) }],
  };
}

export function buildPatchPortalTransaction({
  currentPortal,
  providerResourceId,
  canvasRevision,
  actor,
  now = new Date().toISOString(),
  idempotencyKey,
} = {}) {
  if (!currentPortal || currentPortal.type !== 'resource_portal') {
    throw new TypeError('current_resource_portal_required');
  }
  if (!Number.isInteger(currentPortal.revision) || currentPortal.revision < 0) {
    throw new TypeError('portal_revision_invalid');
  }
  if (typeof providerResourceId !== 'string' || providerResourceId.length === 0) {
    throw new TypeError('provider_resource_id_required');
  }
  const metadata = structuredClone(currentPortal.metadata);
  metadata.portal.providerResourceId = providerResourceId;
  return {
    ...transactionBase({
      canvasId: currentPortal.canvasId,
      canvasRevision,
      actor,
      now,
      idempotencyKey,
    }),
    intent: 'Promote EveAtelier artifact projection',
    expectedOutcome: 'Update one external artifact resource portal',
    operations: [{
      op: 'patch_object',
      objectId: currentPortal.id,
      expectedRevision: currentPortal.revision,
      patch: { metadata },
    }],
  };
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
  transform = {
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: 0,
  },
  style = {},
  displayMode = 'snapshot',
  interactionMode = 'read_only',
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
    bindings: [],
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
