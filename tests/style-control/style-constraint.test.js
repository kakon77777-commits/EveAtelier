import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileStyleConstraintPacket,
} from '../../src/style-control/contracts.js';

function styleDefinition() {
  return {
    schema: 'eve-atelier-style-definition/v1',
    styleId: 'style.eveatelier.gufeng.fine-line-softwash.v0.1',
    maturity: 'EXPERIMENTAL',
    layers: {
      surfaceRendering: {
        description: 'Fine-line soft-wash rendering.',
        initialControl: { lineFineness: 0.88 },
      },
      proportionSyntax: {
        description: 'Slender grounded proportions.',
        initialControl: { silhouetteElongation: 0.78 },
      },
      garmentVolume: {
        description: 'Layered flowing garment volume.',
        initialControl: { garmentFlow: 0.86 },
      },
      compositionRhythm: {
        description: 'Balanced portrait negative space.',
        initialControl: { backgroundMinimality: 0.96 },
      },
      paletteCompatibility: {
        description: 'Low-saturation adaptable palette.',
        initialControl: { saturation: 0.38 },
      },
    },
    constraints: {
      hard: ['preserve character identity'],
      strong: ['retain fine line hierarchy'],
      medium: ['retain layered garment rhythm'],
      soft: ['prefer restrained ornament'],
    },
  };
}

function styleReference() {
  return {
    assetId: 'reference:style-core:01',
    sha256: 'a'.repeat(64),
    role: 'STYLE_CORE_REFERENCE',
    allowedInfluence: {
      surfaceRendering: true,
      proportionSyntax: true,
      garmentVolume: true,
      compositionRhythm: true,
      detailLanguage: true,
      paletteCompatibility: true,
      faceIdentity: false,
      gender: false,
      characterIdentity: false,
      costumeIdentity: false,
    },
  };
}

test('compiles a provider-neutral experimental style constraint packet', () => {
  const packet = compileStyleConstraintPacket({
    packetId: 'example:style-packet:01',
    taskId: 'example:character-style-task:01',
    style: styleDefinition(),
    references: [styleReference()],
  });

  assert.equal(packet.schema, 'eve-atelier-style-constraint-packet/v1');
  assert.equal(packet.styleId, styleDefinition().styleId);
  assert.equal(packet.maturity, 'EXPERIMENTAL');
  assert.deepEqual(packet.controlLayers, styleDefinition().layers);
  assert.deepEqual(packet.constraints, styleDefinition().constraints);
  assert.deepEqual(packet.references, [styleReference()]);
  assert.equal('prompt' in packet, false);
  assert.equal('providerParameters' in packet, false);
});

test('rejects style references that can leak character identity', () => {
  const reference = styleReference();
  reference.allowedInfluence.faceIdentity = true;

  assert.throws(
    () => compileStyleConstraintPacket({
      packetId: 'example:style-packet:01',
      taskId: 'example:character-style-task:01',
      style: styleDefinition(),
      references: [reference],
    }),
    /style_reference_identity_influence_forbidden:faceIdentity/,
  );
});

test('rejects unknown layer, provider, outcome, path, and influence fields', () => {
  const cases = [
    [
      'extra layer',
      input => { input.style.layers.providerWorkflow = {}; },
      /style_layer_forbidden:providerWorkflow/,
    ],
    [
      'nested provider parameters',
      input => { input.style.layers.surfaceRendering.providerParameters = { denoise: 0.4 }; },
      /style_layer_field_forbidden:surfaceRendering:providerParameters/,
    ],
    [
      'outcome constraint',
      input => { input.style.constraints.acceptance = ['ACCEPT']; },
      /style_constraint_strength_forbidden:acceptance/,
    ],
    [
      'private path',
      input => { input.references[0].path = 'D:\\private\\reference.png'; },
      /style_reference_field_forbidden:path/,
    ],
    [
      'unknown identity flag',
      input => { input.references[0].allowedInfluence.identity = true; },
      /style_reference_influence_field_forbidden:identity/,
    ],
  ];

  for (const [name, mutate, expected] of cases) {
    const input = {
      packetId: 'example:style-packet:01',
      taskId: 'example:character-style-task:01',
      style: styleDefinition(),
      references: [styleReference()],
    };
    mutate(input);
    assert.throws(() => compileStyleConstraintPacket(input), expected, name);
  }
});

test('rejects provider knobs disguised as numeric style controls', () => {
  for (const control of ['denoise', 'cfgScale', 'seed', 'loraWeight']) {
    const input = {
      packetId: 'example:style-packet:01',
      taskId: 'example:character-style-task:01',
      style: styleDefinition(),
      references: [styleReference()],
    };
    input.style.layers.surfaceRendering.initialControl[control] = 0.5;

    assert.throws(
      () => compileStyleConstraintPacket(input),
      new RegExp(`style_control_name_forbidden:surfaceRendering:${control}`),
      control,
    );
  }
});
