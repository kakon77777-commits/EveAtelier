import test from 'node:test';
import assert from 'node:assert/strict';
import { digestDefinition } from '../../src/operator-runtime/canonical.js';
import {
  validateExperienceEvent,
  validateOperatorInvocation,
  validateOperatorPack,
  validateProviderCapabilityManifest,
  validateSemanticDirective,
} from '../../src/operator-runtime/contracts.js';
import {
  validDirective,
  validExperienceEvent,
  validInvocation,
  validPack,
  validProviderManifest,
} from './helpers.js';

test('canonical digest is stable across object key order', () => {
  assert.equal(
    digestDefinition({ b: 2, a: { y: 2, x: 1 } }),
    digestDefinition({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.notEqual(
    digestDefinition({ a: 1, b: 2 }),
    digestDefinition({ a: 1, b: 3 }),
  );
});

test('accepts a new semantic axis entirely from a valid data pack', () => {
  const pack = validPack();
  pack.axes.push({
    axisId: 'semantic.axis.example.new-theory',
    description: 'Loaded without changing the runtime kernel.',
    valueSchema: { kind: 'ENUM', values: ['LOW', 'HIGH'] },
  });

  assert.deepEqual(validateOperatorPack(pack), { ok: true });
});

test('rejects schema drift, dangling references, provider fields, and promotion authority', () => {
  const cases = [
    [
      'top-level provider field',
      pack => { pack.providerParameters = { denoise: 0.4 }; },
      'operator_pack_field_forbidden:providerParameters',
    ],
    [
      'duplicate axis',
      pack => { pack.axes.push(structuredClone(pack.axes[0])); },
      'duplicate_axis_id:semantic.axis.example.intensity',
    ],
    [
      'dangling lock axis',
      pack => { pack.locks[0].targetAxisIds = ['semantic.axis.missing']; },
      'unknown_lock_axis:semantic.axis.missing',
    ],
    [
      'dangling compiler output',
      pack => { pack.compilerRules[0].emitsOperatorIds = ['visual.op.missing']; },
      'unknown_compiler_output_operator:visual.op.missing',
    ],
    [
      'invalid scalar bounds',
      pack => { pack.axes[0].valueSchema = { kind: 'SCALAR', min: 2, max: 1 }; },
      'invalid_axis_value_schema:semantic.axis.example.intensity',
    ],
    [
      'provider parameter name',
      pack => {
        pack.families[2].variants[0].parameterSchema.push({
          name: 'modelId',
          kind: 'STRING',
          required: false,
        });
      },
      'operator_parameter_name_forbidden:visual.op.raster.resize:modelId',
    ],
    [
      'promotion authority',
      pack => { pack.families[0].variants[0].authority = 'PROMOTION_GATED'; },
      'operator_authority_forbidden:visual.op.semantic.adjust_axis',
    ],
    [
      'duplicate operator version',
      pack => { pack.families[2].variants.push(structuredClone(pack.families[1].variants[0])); },
      'duplicate_operator_version:visual.op.generative.generate_variation@1.0.0',
    ],
    [
      'unknown required lock',
      pack => { pack.families[2].variants[0].requiredLockIds = ['semantic.lock.missing']; },
      'unknown_operator_lock:semantic.lock.missing',
    ],
    [
      'provider-bound compiler source',
      pack => { pack.compilerRules[0].sourceOperatorId = 'visual.op.raster.resize'; },
      'compiler_source_must_be_compile_only:visual.op.raster.resize',
    ],
    [
      'private local path',
      pack => { pack.description = 'Loaded from D:\\private\\operator-pack.json'; },
      'operator_pack_local_path_forbidden',
    ],
    [
      'unknown nested effect field',
      pack => { pack.families[0].variants[0].effects[0].prompt = 'make it prettier'; },
      'operator_effect_field_forbidden:prompt',
    ],
    [
      'ambiguous compiler source',
      pack => {
        const duplicate = structuredClone(pack.compilerRules[0]);
        duplicate.ruleId = 'compiler.rule.example.adjust-axis-alternate';
        pack.compilerRules.push(duplicate);
      },
      'duplicate_compiler_source_operator:visual.op.semantic.adjust_axis',
    ],
  ];

  for (const [name, mutate, reason] of cases) {
    const pack = validPack();
    mutate(pack);
    assert.deepEqual(validateOperatorPack(pack), { ok: false, reason }, name);
  }
});

test('validates provider-neutral directive, capability, invocation, and experience contracts', () => {
  assert.deepEqual(validateSemanticDirective(validDirective()), { ok: true });
  assert.deepEqual(validateProviderCapabilityManifest(validProviderManifest()), { ok: true });
  assert.deepEqual(validateOperatorInvocation(validInvocation()), { ok: true });
  assert.deepEqual(validateExperienceEvent(validExperienceEvent()), { ok: true });
});

test('rejects provider and outcome fields that cross contract authority boundaries', () => {
  const directive = validDirective();
  directive.providerParameters = { cfg: 7 };
  assert.deepEqual(validateSemanticDirective(directive), {
    ok: false,
    reason: 'semantic_directive_field_forbidden:providerParameters',
  });

  const manifest = validProviderManifest();
  manifest.operators[0].modelId = 'private-model';
  assert.deepEqual(validateProviderCapabilityManifest(manifest), {
    ok: false,
    reason: 'provider_operator_field_forbidden:modelId',
  });

  const invocation = validInvocation();
  invocation.promotion = true;
  assert.deepEqual(validateOperatorInvocation(invocation), {
    ok: false,
    reason: 'operator_invocation_field_forbidden:promotion',
  });

  const pathIdentity = validInvocation();
  pathIdentity.outputArtifactId = 'D:\\private\\output.png';
  assert.deepEqual(validateOperatorInvocation(pathIdentity), {
    ok: false,
    reason: 'operator_invocation_artifact_id_invalid',
  });

  const experience = validExperienceEvent();
  experience.acceptance = 'ACCEPT';
  assert.deepEqual(validateExperienceEvent(experience), {
    ok: false,
    reason: 'operator_experience_field_forbidden:acceptance',
  });

  const overclaim = validExperienceEvent();
  overclaim.provenance = { kind: 'AI', id: 'ai:operator-learner' };
  overclaim.evidenceClass = 'PRODUCTION_OBSERVED';
  assert.deepEqual(validateExperienceEvent(overclaim), {
    ok: false,
    reason: 'operator_experience_evidence_overclaim:AI',
  });
});
