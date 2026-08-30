import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOperatorRequest,
  validateProviderReceipt,
} from '../src/contracts.js';

test('accepts a typed operator request and rejects provider-specific operator names', () => {
  const request = {
    operationId: 'op:1',
    operatorId: 'visual.op.raster.crop',
    operatorVersion: '1.0.0',
    target: { kind: 'asset', id: 'asset:source' },
    constraints: {},
    expectedRevision: 1,
  };
  assert.deepEqual(validateOperatorRequest(request), { ok: true });
  assert.deepEqual(validateOperatorRequest({ ...request, operatorId: 'comfyui.KSampler' }), {
    ok: false,
    reason: 'operator_id_must_be_visual_namespace',
  });
});

test('never treats a completed provider receipt as visual acceptance', () => {
  const receipt = {
    executionId: 'exec:1',
    operationId: 'op:1',
    operatorId: 'visual.op.generative.generate',
    providerId: 'provider:test',
    providerVersion: '1',
    status: 'completed',
    inputRefs: ['asset:source'],
    outputRefs: ['asset:candidate'],
    startedAt: '2026-08-30T00:00:00Z',
    finishedAt: '2026-08-30T00:00:01Z',
    reproducibility: 'best_effort',
  };
  assert.deepEqual(validateProviderReceipt(receipt), { ok: true });
  assert.equal(Object.hasOwn(receipt, 'accepted'), false);
});
