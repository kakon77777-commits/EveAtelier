import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCliArgs,
  validateExecutionGate,
} from '../../scripts/real-mvp/run-character-remaster.mjs';

const config = {
  sourceKind: 'rights_clear_real',
  provider: { type: 'comfyui' },
  evaluator: { model: { modelId: 'model:vision-v1' } },
};

const thresholds = {
  calibrationStatus: 'CALIBRATED',
  calibrationFixtureSet: 'fixture-set:real-v1',
};

test('parses a command and named file arguments without shell-dependent syntax', () => {
  assert.deepEqual(
    parseCliArgs(['generate-evaluate', '--config', 'run.json', '--state', 'state.json']),
    { command: 'generate-evaluate', config: 'run.json', state: 'state.json' },
  );
});

test('rejects external execution without explicit Real MVP opt-in', () => {
  assert.throws(
    () => validateExecutionGate({
      command: 'generate-evaluate',
      env: {},
      config,
      thresholds,
    }),
    /real_mvp_opt_in_required/,
  );
});

test('rejects fixture providers and uncalibrated thresholds before generation', () => {
  assert.throws(
    () => validateExecutionGate({
      command: 'generate-evaluate',
      env: { EVE_REAL_MVP: '1' },
      config: { ...config, provider: { type: 'fixture' } },
      thresholds,
    }),
    /fixture_provider_forbidden_for_real_run/,
  );
  assert.throws(
    () => validateExecutionGate({
      command: 'generate-evaluate',
      env: { EVE_REAL_MVP: '1' },
      config,
      thresholds: { ...thresholds, calibrationStatus: 'EXAMPLE_UNCALIBRATED' },
    }),
    /calibrated_thresholds_required/,
  );
});

test('rejects missing review evidence and candidate mismatch before promotion', () => {
  assert.throws(
    () => validateExecutionGate({
      command: 'review-promote-project',
      env: { EVE_REAL_MVP: '1' },
      config,
      thresholds,
      review: null,
      candidateVersionIds: ['document:character:v1'],
    }),
    /human_review_file_required/,
  );
  assert.throws(
    () => validateExecutionGate({
      command: 'review-promote-project',
      env: { EVE_REAL_MVP: '1' },
      config,
      thresholds,
      review: { candidateVersionId: 'document:character:v2' },
      candidateVersionIds: ['document:character:v1'],
    }),
    /human_review_candidate_mismatch/,
  );
});
