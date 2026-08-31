function semanticVariant() {
  return {
    operatorId: 'visual.op.semantic.adjust_axis',
    version: '1.0.0',
    description: 'Adjust one declared semantic axis.',
    executionMode: 'COMPILE_ONLY',
    inputKinds: ['art.document'],
    outputKinds: ['operator.plan'],
    parameterSchema: [],
    receiptMetadataSchema: [],
    effects: [{ axisId: 'semantic.axis.example.intensity', mode: 'SET' }],
    requiredLockIds: ['semantic.lock.example.identity'],
    requiredCapabilities: [],
    locality: 'GLOBAL',
    determinism: 'DETERMINISTIC',
    reversibility: 'REVERSIBLE',
    authority: 'CANDIDATE_ONLY',
  };
}

function generationVariant() {
  return {
    operatorId: 'visual.op.generative.generate_variation',
    version: '1.0.0',
    description: 'Generate a candidate variation.',
    executionMode: 'PROVIDER_BOUND',
    inputKinds: ['raster.image'],
    outputKinds: ['raster.image'],
    parameterSchema: [],
    receiptMetadataSchema: [],
    effects: [],
    requiredLockIds: [],
    requiredCapabilities: ['generative.variation'],
    locality: 'GLOBAL',
    determinism: 'SEEDED_STOCHASTIC',
    reversibility: 'COMPENSATABLE',
    authority: 'CANDIDATE_ONLY',
  };
}

function resizeVariant() {
  return {
    operatorId: 'visual.op.raster.resize',
    version: '1.0.0',
    description: 'Resize a raster candidate.',
    executionMode: 'PROVIDER_BOUND',
    inputKinds: ['raster.image'],
    outputKinds: ['raster.image'],
    parameterSchema: [
      { name: 'width', kind: 'INTEGER', required: true, min: 1, max: 16384 },
      { name: 'height', kind: 'INTEGER', required: true, min: 1, max: 16384 },
    ],
    receiptMetadataSchema: [
      { name: 'width', kind: 'INTEGER', required: true, min: 1, max: 16384 },
      { name: 'height', kind: 'INTEGER', required: true, min: 1, max: 16384 },
    ],
    effects: [],
    requiredLockIds: [],
    requiredCapabilities: ['raster.resize'],
    locality: 'GLOBAL',
    determinism: 'DETERMINISTIC',
    reversibility: 'COMPENSATABLE',
    authority: 'CANDIDATE_ONLY',
  };
}

export function validPack() {
  return {
    schema: 'eve-atelier-operator-pack/v1',
    packId: 'operator-pack:example-core',
    version: '1.0.0',
    description: 'Synthetic public-safe operator pack.',
    axes: [
      {
        axisId: 'semantic.axis.example.intensity',
        description: 'Synthetic intensity axis.',
        valueSchema: { kind: 'SCALAR', min: 0, max: 1 },
      },
      {
        axisId: 'semantic.axis.example.identity',
        description: 'Synthetic identity continuity axis.',
        valueSchema: { kind: 'SCALAR', min: 0, max: 1 },
      },
    ],
    locks: [
      {
        lockId: 'semantic.lock.example.identity',
        description: 'Preserve synthetic identity evidence.',
        targetAxisIds: ['semantic.axis.example.identity'],
        strength: 'HARD',
        evidenceRequired: true,
      },
    ],
    families: [
      {
        familyId: 'visual.family.semantic.adjust-axis',
        version: '1.0.0',
        description: 'Synthetic semantic operator family.',
        abstraction: 'SEMANTIC',
        variants: [semanticVariant()],
      },
      {
        familyId: 'visual.family.generative.variation',
        version: '1.0.0',
        description: 'Candidate generation family.',
        abstraction: 'EXECUTABLE',
        variants: [generationVariant()],
      },
      {
        familyId: 'visual.family.raster.resize',
        version: '1.0.0',
        description: 'Deterministic raster family.',
        abstraction: 'EXECUTABLE',
        variants: [resizeVariant()],
      },
    ],
    compilerRules: [
      {
        ruleId: 'compiler.rule.example.adjust-axis',
        version: '1.0.0',
        sourceOperatorId: 'visual.op.semantic.adjust_axis',
        emitsOperatorIds: ['visual.op.generative.generate_variation'],
        requiredAxisIds: ['semantic.axis.example.intensity'],
        requiredLockIds: ['semantic.lock.example.identity'],
      },
    ],
  };
}

export function validPackRef() {
  return {
    packId: 'operator-pack:example-core',
    version: '1.0.0',
    digest: 'a'.repeat(64),
  };
}

export function validDirective() {
  return {
    schema: 'eve-atelier-semantic-directive/v1',
    directiveId: 'directive:example:001',
    packRef: validPackRef(),
    operatorRef: {
      operatorId: 'visual.op.semantic.adjust_axis',
      version: '1.0.0',
    },
    target: { kind: 'art.document', id: 'document:example:001' },
    expectedRevision: 3,
    axisChanges: [
      { axisId: 'semantic.axis.example.intensity', mode: 'SET', value: 0.7 },
    ],
    locks: [
      { lockId: 'semantic.lock.example.identity', mode: 'PRESERVE' },
    ],
    requestedAt: '2026-08-31T21:00:00+08:00',
  };
}

export function validProviderManifest() {
  return {
    schema: 'eve-atelier-provider-capability/v1',
    providerId: 'provider:pillow-reference',
    providerVersion: '0.1',
    availability: 'AVAILABLE',
    privacy: 'LOCAL',
    capabilities: ['raster.resize'],
    operators: [
      {
        operatorId: 'visual.op.raster.resize',
        versions: ['1.0.0'],
        evidenceLevel: 'CONTRACT_TESTED',
        costRank: 1,
        latencyRank: 1,
      },
    ],
  };
}

export function validInvocation() {
  return {
    schema: 'eve-atelier-operator-invocation/v1',
    operationId: 'operation:resize:001',
    packRef: validPackRef(),
    operatorRef: {
      operatorId: 'visual.op.raster.resize',
      version: '1.0.0',
    },
    target: { kind: 'art.document', id: 'document:example:001' },
    expectedRevision: 3,
    inputArtifactId: 'artifact:example:source',
    outputArtifactId: 'artifact:example:resized',
    input: 'source.png',
    output: 'resized.png',
    params: { width: 4, height: 5 },
    providerPolicy: {
      allowedPrivacy: ['LOCAL'],
      requiredCapabilities: ['raster.resize'],
    },
  };
}

export function validExperienceEvent() {
  return {
    schema: 'eve-atelier-operator-experience-event/v1',
    eventId: 'experience:example:001',
    operationId: 'operation:resize:001',
    packRef: validPackRef(),
    operatorRef: {
      operatorId: 'visual.op.raster.resize',
      version: '1.0.0',
    },
    providerRef: {
      providerId: 'provider:pillow-reference',
      providerVersion: '0.1',
    },
    semanticContext: {
      axisChanges: [],
      lockIds: [],
    },
    inputHashes: ['b'.repeat(64)],
    outputHashes: ['c'.repeat(64)],
    outcome: 'COMPLETED',
    evaluationRefs: ['evaluation:example:001'],
    evidenceClass: 'CONTRACT_TESTED',
    provenance: {
      kind: 'RUNTIME',
      id: 'operator-runtime:v1',
    },
    occurredAt: '2026-08-31T21:01:00+08:00',
  };
}
