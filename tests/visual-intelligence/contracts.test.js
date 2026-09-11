import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileVisualIntent } from '../../src/visual-intelligence/constraint-compiler.js';
import {
  validateConstraintPacket,
  validateRabclWorkflow,
  validateVisualIntent,
  validateWorkerProfile,
} from '../../src/visual-intelligence/contracts.js';
import { backgroundIntent, human } from './helpers.js';

const at = '2026-09-11T04:00:00Z';

test('tracked v0.3 fixtures are public-safe canonical inputs', async () => {
  const intent = JSON.parse(await readFile(new URL(
    '../../fixtures/visual_intelligence/background-removal-intent.example.json',
    import.meta.url,
  ), 'utf8'));
  const profile = JSON.parse(await readFile(new URL(
    '../../fixtures/visual_intelligence/worker-context-profile.example.json',
    import.meta.url,
  ), 'utf8'));
  assert.equal(validateVisualIntent(intent).ok, true);
  assert.equal(validateWorkerProfile(profile).ok, true);
  assert.equal(/[A-Za-z]:[\\/]/.test(JSON.stringify([intent, profile])), false);
});

test('compiles bounded Chinese background-removal and relight intent into explicit constraints', () => {
  const background = backgroundIntent();
  assert.equal(validateVisualIntent(background).ok, true);
  const packet = compileVisualIntent(background, {
    packetId: 'packet:contract:background',
    compiledAt: at,
  });
  assert.equal(packet.taskType, 'BACKGROUND_REMOVAL');
  assert.equal(packet.requiresHumanClarification, false);
  const dimensions = new Map(packet.constraints.map(item => [item.dimension, item]));
  assert.equal(dimensions.get('IDENTITY').strength, 'HARD');
  assert.equal(dimensions.get('ALPHA').value, 'transparent-background');
  assert.equal(dimensions.get('EDGE').value, 'white-fringe');
  assert.equal(dimensions.get('LOCALITY').mode, 'MINIMIZE');

  const relight = compileVisualIntent(backgroundIntent({
    intentId: 'intent:contract:relight',
    text: '左後冷光，臉留暖光，不要把人改掉。',
  }), {
    packetId: 'packet:contract:relight',
    compiledAt: at,
  });
  assert.equal(relight.taskType, 'RELIGHT');
  const lighting = relight.constraints.filter(item => item.dimension === 'LIGHTING');
  assert.deepEqual(lighting.map(item => item.value), [{
    direction: 'REAR_LEFT', temperature: 'COOL',
  }, {
    region: 'FACE', temperature: 'WARM',
  }]);
  assert.equal(relight.constraints.find(item => item.dimension === 'IDENTITY').strength, 'HARD');
});

test('unknown intent requires human clarification and never invents a task', () => {
  const packet = compileVisualIntent(backgroundIntent({
    intentId: 'intent:contract:unknown',
    text: '讓它更有那個感覺。',
  }), {
    packetId: 'packet:contract:unknown',
    compiledAt: at,
  });
  assert.equal(packet.taskType, 'UNKNOWN');
  assert.equal(packet.requiresHumanClarification, true);
});

test('rejects implementation leakage in constraints and RABCL parameters', () => {
  const packet = compileVisualIntent(backgroundIntent(), {
    packetId: 'packet:contract:leak',
    compiledAt: at,
  });
  packet.constraints[0].value = { model: 'forbidden-checkpoint' };
  assert.deepEqual(validateConstraintPacket(packet), {
    ok: false,
    reason: 'aads_constraint_invalid',
  });

  const workflow = {
    schema: 'eve-atelier-rabcl-workflow/v1',
    workflowId: 'workflow:contract:leak',
    version: '1.0.0',
    planId: 'plan:contract:leak',
    packetId: 'packet:contract:leak',
    entryNodeId: 'operator',
    nodes: [{
      nodeId: 'operator',
      kind: 'OPERATOR',
      maxVisits: 1,
      operatorRef: { operatorId: 'visual.op.raster.resize', version: '1.0.0' },
      targetBinding: { kind: 'INITIAL', nodeId: null },
      params: { prompt: 'forbidden' },
      providerPolicy: {
        allowedPrivacy: ['LOCAL'],
        requiredSupports: [],
        allowedLicenseSpdx: ['Apache-2.0'],
        allowedLicenseBoundaries: ['LIBRARY'],
        verifiedAtOrAfter: at,
      },
      output: { mediaType: 'image/png', extension: 'png' },
      commit: { kind: 'CANDIDATE_VERSION', outputRole: 'RESIZED' },
      onSuccess: 'stop',
      onFailure: 'stop',
      fallback: [],
    }, {
      nodeId: 'stop', kind: 'STOP', maxVisits: 1, outcome: 'FAILED',
    }],
    createdAt: at,
  };
  assert.equal(validateRabclWorkflow(workflow).reason, 'rabcl_workflow_node_invalid');
  delete workflow.nodes[0].params.prompt;
  workflow.nodes[0].params.width = 8;
  workflow.nodes[0].onSuccess = 'missing';
  assert.equal(validateRabclWorkflow(workflow).reason, 'rabcl_workflow_edge_dangling');
  workflow.nodes[0].onSuccess = 'stop';
  workflow.nodes[0].maxVisits = 0;
  assert.equal(validateRabclWorkflow(workflow).reason, 'rabcl_workflow_node_invalid');
});

test('visual intent accepts only human authors and path-safe content', () => {
  assert.equal(validateVisualIntent(backgroundIntent({
    submittedBy: { kind: 'AI', id: 'ai:not-authority' },
  })).ok, false);
  assert.equal(validateVisualIntent(backgroundIntent({
    text: 'read C:\\private\\source.png',
  })).ok, false);
  assert.equal(validateVisualIntent(backgroundIntent({
    overrides: [{ scope: 'COLOR', instruction: 'blue', actor: human }],
  })).ok, true);
});
