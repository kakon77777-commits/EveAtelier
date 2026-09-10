import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { executeInvocation } from '../operator-runtime/runtime.js';
import {
  chooseFallbackDecision,
  matchArtProviderCapability,
  projectArtCapabilityToV1,
} from './provider-capability.js';

function operationFilename(operationId, extension) {
  const digest = createHash('sha256').update(operationId).digest('hex');
  return `${digest}.${extension.replace(/^\./, '')}`;
}

function operatorFromPack(pack, operatorRef) {
  return pack.families.flatMap(family => family.variants).find(item => (
    item.operatorId === operatorRef.operatorId && item.version === operatorRef.version
  ));
}

function classifyWorkbenchFailure(error) {
  const code = error?.code ?? error?.message ?? String(error);
  if (/QUALITY_FAILURE/i.test(code)) return 'QUALITY_FAILURE';
  if (/TIMEOUT|AbortError/i.test(code)) return 'TIMEOUT';
  if (/PROVIDER_FAMILY_MISMATCH/i.test(code)) return 'PROVIDER_FAMILY_MISMATCH';
  if (/no_compatible|PROVIDER_UNAVAILABLE/i.test(code)) return 'PROVIDER_UNAVAILABLE';
  if (/CONSTRAINT/i.test(code)) return 'CONSTRAINT_FAILURE';
  return 'PRECONDITION_FAILED';
}

export class WorkbenchExecutionBridge {
  #assetStore;
  #documentStore;
  #operatorStore;
  #targetResolver;
  #providers;
  #manifests;
  #stagingRoot;
  #mrmicClient;

  constructor({
    assetStore,
    documentStore,
    operatorStore,
    targetResolver,
    providers,
    manifests,
    stagingRoot,
    mrmicClient = null,
  }) {
    if (!assetStore || !documentStore || !operatorStore || !targetResolver) {
      throw new TypeError('workbench_runtime_stores_required');
    }
    if (!Array.isArray(providers) || !Array.isArray(manifests)) {
      throw new TypeError('workbench_runtime_providers_required');
    }
    if (typeof stagingRoot !== 'string' || stagingRoot.length === 0) {
      throw new TypeError('workbench_runtime_staging_root_required');
    }
    this.#assetStore = assetStore;
    this.#documentStore = documentStore;
    this.#operatorStore = operatorStore;
    this.#targetResolver = targetResolver;
    this.#providers = providers;
    this.#manifests = manifests;
    this.#stagingRoot = resolve(stagingRoot);
    this.#mrmicClient = mrmicClient;
    mkdirSync(this.#stagingRoot, { recursive: true });
  }

  createProject(project) {
    return this.#documentStore.registerProject(project);
  }

  async createDocumentFromSource({
    document,
    sourcePath,
    mediaType,
    sourceVersionId,
    assetBindingId,
    currentEventId,
    actor,
    occurredAt,
    components = {},
  }) {
    const metadata = await sharp(sourcePath).metadata();
    const expectedMediaTypes = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      tiff: 'image/tiff',
    };
    if (metadata.width !== document.canvasExtent.width
        || metadata.height !== document.canvasExtent.height
        || String(metadata.space).toLowerCase() !== String(document.colorSpace).toLowerCase()
        || expectedMediaTypes[metadata.format] !== mediaType) {
      throw new Error('art_source_raster_declaration_mismatch');
    }
    const asset = this.#assetStore.registerFile({
      sourcePath,
      mediaType,
      registeredAt: occurredAt,
    });
    const version = {
      schema: 'eve-atelier-art-document-version/v1',
      versionId: sourceVersionId,
      documentId: document.documentId,
      parentVersionIds: [],
      primaryAsset: asset,
      primaryAssetStatus: 'CURRENT_RENDER',
      canvasExtent: structuredClone(document.canvasExtent),
      colorSpace: document.colorSpace,
      createdByExecutionId: null,
      createdAt: occurredAt,
      kind: 'SOURCE',
    };
    const assetBinding = {
      schema: 'eve-atelier-art-asset-binding/v1',
      bindingId: assetBindingId,
      documentId: document.documentId,
      versionId: sourceVersionId,
      assetRef: asset,
      assetRole: 'PRIMARY',
      target: { kind: 'DOCUMENT_VERSION', id: sourceVersionId },
      createdAt: occurredAt,
    };
    const currentEvent = {
      schema: 'eve-atelier-art-current-event/v1',
      eventId: currentEventId,
      documentId: document.documentId,
      fromVersionId: null,
      toVersionId: sourceVersionId,
      reason: 'INITIAL',
      evaluationId: null,
      reviewId: null,
      evidenceRefs: [`evidence:asset:${asset.sha256}`],
      actor,
      occurredAt,
    };
    return this.#documentStore.createDocumentWithSource({
      document,
      version,
      assetBinding,
      currentEvent,
      components,
    });
  }

  async executeOperator({
    operationId,
    packRef,
    operatorRef,
    target,
    params,
    providerPolicy,
    outputMediaType,
    outputExtension,
    commit,
    observedCanvasRevision = null,
    canvasRevisionReader = null,
    now = () => new Date().toISOString(),
  }) {
    if (!operationId || !packRef || !operatorRef || !commit) {
      throw new TypeError('workbench_operator_request_invalid');
    }
    const pack = this.#operatorStore.getPack(packRef);
    if (this.#operatorStore.getStatus(packRef) !== 'ACTIVE') {
      throw new Error('operator_pack_not_active');
    }
    const operator = operatorFromPack(pack, operatorRef);
    if (!operator) throw new Error('workbench_operator_not_found');
    if (operator.authority === 'OBSERVATION_ONLY' && commit.kind !== 'ASSET_ONLY') {
      throw new Error('workbench_observation_operator_commit_forbidden');
    }
    const firstCanvasRevision = await this.#readCanvasRevision(
      target,
      observedCanvasRevision,
      canvasRevisionReader,
    );
    const resolved = this.#targetResolver.resolve(target, {
      observedCanvasRevision: firstCanvasRevision,
    });
    const binding = this.#resolveInputBinding(resolved, operator, params);
    const requirements = this.#deriveProviderRequirements({
      operator,
      resolved,
      providerPolicy,
      inputKind: binding.inputKind,
    });
    const selectedManifest = matchArtProviderCapability({
      manifests: this.#manifests,
      operatorRef,
      requirements,
    });
    const provider = this.#providers.find(item => (
      item.providerId === selectedManifest.providerId
      && item.providerVersion === selectedManifest.providerVersion
    ));
    if (!provider) throw new Error('workbench_provider_object_identity_mismatch');
    const output = join(this.#stagingRoot, operationFilename(operationId, outputExtension));
    if (existsSync(output)) throw new Error('workbench_staging_output_exists');
    const compiledProvider = this.#compileProviderParams(binding.params);
    const providerParams = compiledProvider.params;
    const input = this.#assetStore.getPath(binding.asset);
    const pendingOutputId = `artifact:pending:${createHash('sha256').update(operationId).digest('hex')}`;
    const invocation = {
      schema: 'eve-atelier-operator-invocation/v1',
      operationId,
      packRef: structuredClone(packRef),
      operatorRef: structuredClone(operatorRef),
      target: {
        kind: `art.${target.targetKind.toLowerCase()}`,
        id: target.componentId ?? target.versionId,
      },
      expectedRevision: resolved.documentRevision,
      inputArtifactId: binding.asset.assetId,
      outputArtifactId: pendingOutputId,
      input,
      output,
      params: providerParams,
      providerPolicy: {
        allowedPrivacy: [selectedManifest.privacy],
        requiredCapabilities: [...operator.requiredCapabilities],
      },
    };
    const receipt = await executeInvocation({
      store: this.#operatorStore,
      manifests: [projectArtCapabilityToV1(selectedManifest)],
      providers: [provider],
      invocation,
      now,
      revisionGuard: async () => {
        const currentCanvasRevision = await this.#readCanvasRevision(
          target,
          observedCanvasRevision,
          canvasRevisionReader,
        );
        const checked = this.#targetResolver.revalidate(resolved, {
          observedCanvasRevision: currentCanvasRevision,
        });
        return { ok: true, evidenceRef: checked.revisionEvidenceRef };
      },
    });

    const finalCanvasRevision = await this.#readCanvasRevision(
      target,
      observedCanvasRevision,
      canvasRevisionReader,
    );
    this.#targetResolver.revalidate(resolved, {
      observedCanvasRevision: finalCanvasRevision,
    });
    this.#validateOutputDeclaration({
      receipt,
      outputMediaType,
      outputExtension,
      outputKind: operator.outputKinds[0],
      documentColorSpace: resolved.version.colorSpace,
    });
    const registeredAt = now();
    const asset = this.#assetStore.registerDerivedFile({
      sourcePath: output,
      mediaType: outputMediaType,
      registeredAt,
      parentAssetIds: [...new Set([
        binding.asset.assetId,
        ...compiledProvider.auxiliaryAssets.map(item => item.assetId),
      ])],
      executionId: receipt.executionId,
      lineageEventPrefix: `lineage:${receipt.executionId}`,
    });
    const workbenchReceipt = {
      schema: 'eve-atelier-workbench-execution-receipt/v1',
      executionId: receipt.executionId,
      operationId: receipt.operationId,
      providerReceipt: receipt,
      inputAssets: [
        structuredClone(binding.asset),
        ...compiledProvider.auxiliaryAssets.map(item => structuredClone(item)),
      ],
      outputAsset: structuredClone(asset),
      status: 'completed',
      recordedAt: registeredAt,
    };
    if (commit.kind === 'ASSET_ONLY') {
      this.#documentStore.appendAssetOnlyExecutionReceipt(workbenchReceipt, registeredAt);
      return {
        receipt: workbenchReceipt,
        providerReceipt: receipt,
        asset,
        candidate: null,
        resolvedTarget: resolved,
      };
    }
    if (commit.kind !== 'CANDIDATE_VERSION'
        || typeof commit.versionId !== 'string'
        || typeof commit.assetBindingId !== 'string') {
      throw new Error('workbench_commit_policy_invalid');
    }
    const componentReplacementKind = ['LAYER', 'MASK', 'SELECTION']
      .includes(resolved.target.targetKind)
      && !(resolved.target.targetKind === 'LAYER'
        && resolved.component.layerType === 'GROUP')
      ? resolved.target.targetKind
      : null;
    const componentPolicy = componentReplacementKind !== null
      || operator.preservation.structure !== 'CHANGES'
      ? 'COPY_FORWARD'
      : 'INVALIDATE_SPATIAL';
    const primaryAsset = componentReplacementKind === null
      ? asset
      : resolved.primaryAsset;
    const version = {
      schema: 'eve-atelier-art-document-version/v1',
      versionId: commit.versionId,
      documentId: resolved.document.documentId,
      parentVersionIds: [resolved.version.versionId],
      primaryAsset,
      primaryAssetStatus: componentReplacementKind === null
        ? 'CURRENT_RENDER'
        : 'STALE_REQUIRES_COMPOSITE',
      canvasExtent: componentReplacementKind === null
        ? { width: receipt.metadata.width, height: receipt.metadata.height }
        : structuredClone(resolved.version.canvasExtent),
      colorSpace: componentReplacementKind === null
        ? receipt.metadata.colourspace
        : resolved.version.colorSpace,
      createdByExecutionId: receipt.executionId,
      createdAt: registeredAt,
      kind: 'CANDIDATE',
    };
    const assetBinding = {
      schema: 'eve-atelier-art-asset-binding/v1',
      bindingId: commit.assetBindingId,
      documentId: resolved.document.documentId,
      versionId: commit.versionId,
      assetRef: primaryAsset,
      assetRole: 'PRIMARY',
      target: { kind: 'DOCUMENT_VERSION', id: commit.versionId },
      createdAt: registeredAt,
    };
    const candidate = this.#documentStore.appendCandidateGraph({
      receipt: workbenchReceipt,
      recordedAt: registeredAt,
      version,
      assetBinding,
      expectedState: {
        documentId: resolved.document.documentId,
        parentVersionId: resolved.version.versionId,
        inputAsset: structuredClone(binding.asset),
        outputAsset: structuredClone(asset),
        expectedCurrentVersionId: resolved.target.expectedCurrentVersionId
          ?? resolved.currentVersionId,
        expectedDocumentRevision: resolved.documentRevision,
        targetKind: resolved.target.targetKind,
        componentId: resolved.target.componentId,
        componentRevision: resolved.componentRevision,
        componentGraphDigest: resolved.componentGraphDigest,
      },
      componentReplacement: componentReplacementKind === null
        ? null
        : {
            kind: componentReplacementKind,
            id: resolved.target.componentId,
            assetRef: structuredClone(asset),
          },
      componentPolicy,
    });
    return {
      receipt: workbenchReceipt,
      providerReceipt: receipt,
      asset,
      candidate,
      resolvedTarget: resolved,
    };
  }

  async executeOperatorWithFallback(options) {
    const context = options?.fallbackContext ?? {};
    if (typeof context.alternativeProviderAvailable !== 'boolean'
        || typeof context.localRepairAvailable !== 'boolean') {
      throw new TypeError('workbench_fallback_context_invalid');
    }
    const pack = this.#operatorStore.getPack(options.packRef);
    const operator = operatorFromPack(pack, options.operatorRef);
    if (!operator) throw new Error('workbench_operator_not_found');
    try {
      return { status: 'COMPLETED', result: await this.executeOperator(options) };
    } catch (error) {
      const failureClass = classifyWorkbenchFailure(error);
      const proposed = chooseFallbackDecision({
        failureClass,
        alternativeProviderAvailable: context.alternativeProviderAvailable,
        localRepairAvailable: context.localRepairAvailable,
        stochastic: operator.determinism === 'SEEDED_STOCHASTIC',
      });
      const decision = operator.fallbackDecisions.includes(proposed)
        ? proposed
        : operator.fallbackDecisions.includes('ASK_HUMAN')
          ? 'ASK_HUMAN'
          : operator.fallbackDecisions[0];
      return {
        status: 'FAILED',
        failure: {
          schema: 'eve-atelier-workbench-fallback/v1',
          failureClass,
          decision,
          operatorRef: structuredClone(options.operatorRef),
          allowedDecisions: [...operator.fallbackDecisions],
          retryAuthorized: false,
          cause: error?.message ?? String(error),
        },
      };
    }
  }

  recordEvaluation(evaluation) {
    return this.#documentStore.recordEvaluation(evaluation);
  }

  recordHumanReview(review) {
    return this.#documentStore.recordHumanReview(review);
  }

  promoteCandidate({
    documentId,
    versionId,
    evaluationId,
    reviewId = null,
    eventId,
    actor,
    evidenceRefs,
    expectedCurrentVersionId,
    occurredAt,
  }) {
    const snapshot = this.#documentStore.getDocumentSnapshot(documentId);
    if (snapshot.currentVersion.versionId !== expectedCurrentVersionId) {
      throw new Error(`art_promotion_stale_current:${snapshot.currentVersion.versionId}`);
    }
    return this.#documentStore.promoteCandidate({
      schema: 'eve-atelier-art-current-event/v1',
      eventId,
      documentId,
      fromVersionId: expectedCurrentVersionId,
      toVersionId: versionId,
      reason: 'PROMOTION',
      evaluationId,
      reviewId,
      evidenceRefs,
      actor,
      occurredAt,
    });
  }

  restoreVersion({
    documentId,
    versionId,
    eventId,
    actor,
    evidenceRefs,
    expectedCurrentVersionId,
    occurredAt,
  }) {
    const snapshot = this.#documentStore.getDocumentSnapshot(documentId);
    if (snapshot.currentVersion.versionId !== expectedCurrentVersionId) {
      throw new Error(`art_restore_stale_current:${snapshot.currentVersion.versionId}`);
    }
    return this.#documentStore.restoreVersion({
      schema: 'eve-atelier-art-current-event/v1',
      eventId,
      documentId,
      fromVersionId: expectedCurrentVersionId,
      toVersionId: versionId,
      reason: 'RESTORE',
      evaluationId: null,
      reviewId: null,
      evidenceRefs,
      actor,
      occurredAt,
    });
  }

  async projectPortalOnce(options) {
    if (!this.#mrmicClient) throw new Error('mrmic_client_not_configured');
    if (!['CREATE', 'PATCH'].includes(options.mode)
        || options.request?.idempotencyKey !== options.idempotencyKey) {
      throw new Error('art_projection_request_idempotency_mismatch');
    }
    const existing = this.#documentStore.getProjectionEventByIdempotencyKey(
      options.idempotencyKey,
      { allowMissing: true },
    );
    if (existing) {
      if (existing.projectionEventId !== options.projectionEventId
          || existing.documentId !== options.documentId
          || existing.versionId !== options.versionId
          || existing.providerResourceId !== options.providerResourceId) {
        throw new Error('art_projection_idempotency_conflict');
      }
      return {
        status: existing.status,
        event: existing,
        retryAuthorized: false,
        duplicateSuppressed: true,
      };
    }
    const prepared = this.#documentStore.getProjectionAttemptByIdempotencyKey(
      options.idempotencyKey,
      { allowMissing: true },
    );
    if (prepared) {
      if (prepared.documentId !== options.documentId
          || prepared.versionId !== options.versionId
          || prepared.providerResourceId !== options.providerResourceId
          || prepared.projectionEventId !== options.projectionEventId
          || prepared.mode !== options.mode) {
        throw new Error('art_projection_idempotency_conflict');
      }
      return {
        status: 'UNCERTAIN',
        event: null,
        attempt: prepared,
        retryAuthorized: false,
        duplicateSuppressed: true,
      };
    }
    const version = this.#documentStore.getVersion(options.versionId);
    if (version.documentId !== options.documentId) {
      throw new Error('art_projection_version_scope_mismatch');
    }
    this.#assetStore.verifyAsset(version.primaryAsset);
    if (!['CANDIDATE', 'CURRENT'].includes(options.projectionRole)) {
      throw new Error('art_projection_role_invalid');
    }
    if (options.projectionRole === 'CURRENT'
        && this.#documentStore.getDocumentSnapshot(options.documentId)
          .currentVersion.versionId !== options.versionId) {
      throw new Error('art_projection_current_version_mismatch');
    }
    if (typeof options.providerResourceId !== 'string'
        || !options.providerResourceId.includes(options.versionId)
        || !options.providerResourceId.includes(version.primaryAsset.sha256)) {
      throw new Error('art_projection_resource_identity_mismatch');
    }
    const requestResourceId = options.mode === 'CREATE'
      ? options.request?.portal?.metadata?.portal?.providerResourceId
      : options.request?.providerResourceId;
    if (requestResourceId !== options.providerResourceId) {
      throw new Error('art_projection_request_resource_mismatch');
    }
    const attempt = this.#documentStore.prepareProjectionAttempt({
      schema: 'eve-atelier-art-projection-attempt/v1',
      attemptId: `projection-attempt:${createHash('sha256')
        .update(options.idempotencyKey).digest('hex')}`,
      projectionEventId: options.projectionEventId,
      documentId: options.documentId,
      versionId: options.versionId,
      mode: options.mode,
      idempotencyKey: options.idempotencyKey,
      providerResourceId: options.providerResourceId,
      preparedAt: options.recordedAt,
    });
    let status;
    let code;
    let result;
    try {
      result = options.mode === 'CREATE'
        ? await this.#mrmicClient.projectPortal(options.request)
        : await this.#mrmicClient.patchPortal(options.request);
      const portal = result?.portal;
      if (!portal
          || portal.type !== 'resource_portal'
          || portal.metadata?.portal?.provider !== 'external'
          || portal.metadata?.portal?.resourceKind !== 'artifact'
          || portal.metadata?.portal?.providerResourceId !== options.providerResourceId
          || portal.metadata?.ownershipTransferred !== false) {
        throw new Error('mrmic_portal_readback_mismatch');
      }
      status = 'VERIFIED';
    } catch (error) {
      status = error?.code === 'UNKNOWN_AFTER_DISPATCH' ? 'UNCERTAIN' : 'FAILED';
      code = error?.code ?? 'MRMIC_PROJECTION_FAILED';
    }
    const event = this.#documentStore.recordProjectionEvent({
      schema: 'eve-atelier-art-projection-event/v1',
      projectionEventId: options.projectionEventId,
      documentId: options.documentId,
      versionId: options.versionId,
      status,
      idempotencyKey: options.idempotencyKey,
      providerResourceId: options.providerResourceId,
      evidenceRefs: status === 'VERIFIED'
        ? [options.evidenceRef]
        : [`projection:${code}`],
      recordedAt: options.recordedAt,
    });
    return {
      status,
      code,
      result,
      event,
      attempt,
      retryAuthorized: false,
    };
  }

  #compileProviderParams(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new TypeError('workbench_operator_params_required');
    }
    const result = structuredClone(params);
    const auxiliaryAssets = [];
    for (const name of ['mask', 'overlay']) {
      const value = result[name];
      if (value !== undefined) {
        if (typeof value !== 'string' || !value.startsWith('asset:sha256:')) {
          throw new Error(`workbench_provider_asset_parameter_invalid:${name}`);
        }
        const asset = this.#assetStore.getAsset(value);
        auxiliaryAssets.push(asset);
        result[name] = this.#assetStore.getPath(asset);
      }
    }
    if (result.stack !== undefined) {
      if (!Array.isArray(result.stack) || result.stack.length === 0) {
        throw new Error('workbench_layer_stack_invalid');
      }
      result.stack = result.stack.map(item => this.#compileLayerPlan(item, auxiliaryAssets));
    }
    return { params: result, auxiliaryAssets };
  }

  #compileLayerPlan(item, auxiliaryAssets) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || !['GROUP', 'LAYER'].includes(item.kind)
        || typeof item.layerId !== 'string'
        || typeof item.visible !== 'boolean'
        || !Number.isFinite(item.opacity)
        || typeof item.blend !== 'string'
        || !Array.isArray(item.maskAssetIds)) {
      throw new Error('workbench_layer_stack_item_invalid');
    }
    const masks = item.maskAssetIds.map(assetId => {
      const asset = this.#assetStore.getAsset(assetId);
      auxiliaryAssets.push(asset);
      return this.#assetStore.getPath(asset);
    });
    if (item.kind === 'GROUP') {
      if (!Array.isArray(item.children) || item.children.length === 0
          || item.assetId !== null) {
        throw new Error('workbench_layer_group_plan_invalid');
      }
      return {
        kind: 'GROUP',
        layerId: item.layerId,
        visible: item.visible,
        opacity: item.opacity,
        blend: item.blend,
        masks,
        children: item.children.map(child => this.#compileLayerPlan(child, auxiliaryAssets)),
      };
    }
    if (typeof item.assetId !== 'string' || item.children !== null) {
      throw new Error('workbench_layer_plan_invalid');
    }
    const asset = this.#assetStore.getAsset(item.assetId);
    auxiliaryAssets.push(asset);
    return {
      kind: 'LAYER',
      layerId: item.layerId,
      visible: item.visible,
      opacity: item.opacity,
      blend: item.blend,
      masks,
      input: this.#assetStore.getPath(asset),
    };
  }

  #layerPlan(documentId, versionId, layer) {
    const maskAssetIds = layer.maskIds.map(maskId => {
      const mask = this.#documentStore.getMask(maskId);
      if (mask.documentId !== documentId || mask.versionId !== versionId) {
        throw new Error('workbench_layer_mask_scope_mismatch');
      }
      return mask.assetRef.assetId;
    });
    if (layer.layerType !== 'GROUP') {
      if (layer.assetRef === null) throw new Error('art_layer_raster_asset_required');
      return {
        kind: 'LAYER',
        layerId: layer.layerId,
        visible: layer.visibility,
        opacity: layer.opacity,
        blend: layer.blendMode,
        maskAssetIds,
        assetId: layer.assetRef.assetId,
        children: null,
      };
    }
    const children = this.#documentStore.listLayers(documentId, versionId)
      .filter(candidate => candidate.parentLayerId === layer.layerId)
      .sort((left, right) => left.order - right.order)
      .map(child => this.#layerPlan(documentId, versionId, child));
    if (children.length === 0) throw new Error('art_layer_group_empty');
    return {
      kind: 'GROUP',
      layerId: layer.layerId,
      visible: layer.visibility,
      opacity: layer.opacity,
      blend: layer.blendMode,
      maskAssetIds,
      assetId: null,
      children,
    };
  }

  #resolveInputBinding(resolved, operator, params) {
    if (operator.locality === 'REGIONAL'
        && !['REGION', 'SELECTION', 'MASK'].includes(resolved.target.targetKind)
        && !(typeof params?.mask === 'string'
          && params.mask.startsWith('asset:sha256:'))) {
      throw new Error('art_operator_regional_target_required');
    }
    let asset = resolved.primaryAsset;
    let inputKind = 'raster.image';
    const compiledParams = structuredClone(params);
    switch (resolved.target.targetKind) {
      case 'DOCUMENT':
      case 'DOCUMENT_VERSION':
        break;
      case 'LAYER':
        if (resolved.component.layerType === 'GROUP') {
          if (operator.operatorId !== 'visual.op.composite.layer_composite') {
            throw new Error('art_layer_group_operator_unsupported');
          }
          if (['overlay', 'left', 'top', 'opacity', 'blend', 'mask', 'stack']
            .some(name => compiledParams[name] !== undefined)) {
            throw new Error('art_layer_group_caller_stack_forbidden');
          }
          compiledParams.stack = [this.#layerPlan(
            resolved.document.documentId,
            resolved.version.versionId,
            resolved.component,
          )];
        } else {
          if (compiledParams.stack !== undefined) {
            throw new Error('art_layer_stack_target_required');
          }
          if (resolved.component.assetRef === null) throw new Error('art_layer_raster_asset_required');
          asset = resolved.component.assetRef;
        }
        break;
      case 'MASK':
        asset = resolved.component.assetRef;
        inputKind = 'raster.mask';
        break;
      case 'SELECTION':
        if (resolved.component.representation.kind !== 'MASK') {
          throw new Error('art_selection_provider_representation_unavailable');
        }
        if (operator.locality === 'REGIONAL') {
          if (operator.parameterSchema.some(item => item.name === 'mask')
              && compiledParams.mask === undefined) {
            compiledParams.mask = resolved.component.representation.assetRef.assetId;
          }
        } else {
          asset = resolved.component.representation.assetRef;
          inputKind = 'raster.mask';
        }
        break;
      case 'REGION':
        if (resolved.component.representation.kind !== 'MASK') {
          throw new Error('art_region_provider_representation_unavailable');
        }
        if (operator.parameterSchema.some(item => item.name === 'mask')
            && compiledParams.mask === undefined) {
          compiledParams.mask = this.#documentStore
            .getMask(resolved.component.representation.refId).assetRef.assetId;
        }
        break;
      case 'STRUCTURE':
      case 'FIELD':
        throw new Error('art_target_provider_representation_unavailable');
      default:
        throw new Error('art_target_kind_unsupported');
    }
    if (!operator.inputKinds.includes(inputKind)) {
      throw new Error(`art_operator_input_kind_mismatch:${inputKind}`);
    }
    this.#assetStore.verifyAsset(asset);
    return { asset, inputKind, params: compiledParams };
  }

  #deriveProviderRequirements({ operator, resolved, providerPolicy, inputKind }) {
    const fields = [
      'allowedPrivacy', 'requiredSupports', 'allowedLicenseSpdx',
      'allowedLicenseBoundaries', 'verifiedAtOrAfter',
    ];
    if (!providerPolicy
        || typeof providerPolicy !== 'object'
        || Array.isArray(providerPolicy)
        || Object.keys(providerPolicy).length !== fields.length
        || Object.keys(providerPolicy).some(key => !fields.includes(key))
        || !Array.isArray(providerPolicy.allowedPrivacy)
        || !Array.isArray(providerPolicy.requiredSupports)
        || !Array.isArray(providerPolicy.allowedLicenseSpdx)
        || !Array.isArray(providerPolicy.allowedLicenseBoundaries)) {
      throw new TypeError('workbench_provider_policy_invalid');
    }
    const derivedSupports = new Set(providerPolicy.requiredSupports);
    if (inputKind === 'raster.mask' || operator.outputKinds.includes('raster.mask')) {
      derivedSupports.add('alpha');
    }
    if (operator.operatorId === 'visual.op.composite.layer_composite'
        || resolved.target.targetKind === 'LAYER') derivedSupports.add('layers');
    const determinism = operator.determinism === 'NONDETERMINISTIC'
      ? 'PROVIDER_DEPENDENT'
      : operator.determinism;
    const reproducibility = determinism === 'DETERMINISTIC'
      ? 'EXACT'
      : determinism === 'SEEDED_STOCHASTIC'
        ? 'SEEDED'
        : 'BEST_EFFORT';
    if (operator.outputKinds.length !== 1) throw new Error('art_operator_output_kind_ambiguous');
    return {
      allowedPrivacy: [...providerPolicy.allowedPrivacy],
      inputKind,
      outputKind: operator.outputKinds[0],
      locality: operator.locality,
      width: resolved.version.canvasExtent.width,
      height: resolved.version.canvasExtent.height,
      requiredSupports: [...derivedSupports],
      requiredCapabilities: [...operator.requiredCapabilities],
      allowedDeterminism: [determinism],
      allowedReproducibility: [reproducibility],
      allowedLicenseSpdx: [...providerPolicy.allowedLicenseSpdx],
      allowedLicenseBoundaries: [...providerPolicy.allowedLicenseBoundaries],
      verifiedAtOrAfter: providerPolicy.verifiedAtOrAfter,
    };
  }

  #validateOutputDeclaration({
    receipt,
    outputMediaType,
    outputExtension,
    outputKind,
    documentColorSpace,
  }) {
    const format = receipt.metadata?.format;
    const mediaTypes = {
      png: 'image/png',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      tiff: 'image/tiff',
    };
    const extensions = {
      png: ['png'],
      jpeg: ['jpg', 'jpeg'],
      webp: ['webp'],
      tiff: ['tif', 'tiff'],
    };
    const normalizedExtension = outputExtension.replace(/^\./, '').toLowerCase();
    if (!(format in mediaTypes)
        || outputMediaType !== mediaTypes[format]
        || !extensions[format].includes(normalizedExtension)) {
      throw new Error('workbench_output_media_declaration_mismatch');
    }
    if (outputKind !== 'raster.mask'
        && String(receipt.metadata?.colourspace).toLowerCase()
          !== String(documentColorSpace).toLowerCase()) {
      throw new Error('workbench_output_colourspace_mismatch');
    }
  }

  async #readCanvasRevision(target, fallback, reader) {
    if (target.expectedCanvasRevision === null) return null;
    if (typeof reader === 'function') {
      const value = await reader();
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('canvas_revision_reader_invalid');
      }
      return value;
    }
    return fallback;
  }
}
