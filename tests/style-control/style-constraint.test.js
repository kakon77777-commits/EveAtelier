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
      surfaceRendering: { target: 'fine-line-soft-wash' },
      proportionSyntax: { target: 'slender-grounded' },
      garmentVolume: { target: 'layered-flowing' },
      compositionRhythm: { target: 'portrait-negative-space-balanced' },
      paletteCompatibility: { target: 'low-saturation-cool-warm-balanced' },
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
    packetId: 'style-packet:character-remaster-1086:01',
    taskId: 'character-remaster-1086',
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
      packetId: 'style-packet:character-remaster-1086:01',
      taskId: 'character-remaster-1086',
      style: styleDefinition(),
      references: [reference],
    }),
    /style_reference_identity_influence_forbidden:faceIdentity/,
  );
});
