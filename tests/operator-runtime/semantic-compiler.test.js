import test from 'node:test';
import assert from 'node:assert/strict';
import { OperatorRegistryStore } from '../../src/operator-runtime/registry-store.js';
import { compileSemanticDirective } from '../../src/operator-runtime/semantic-compiler.js';
import { validDirective, validPack } from './helpers.js';

function humanActor() {
  return { kind: 'HUMAN', id: 'human:local-reviewer' };
}

function register(store) {
  return store.registerPack({
    pack: validPack(),
    proposer: humanActor(),
    registeredAt: '2026-08-31T21:20:00+08:00',
  });
}

function transition(store, ref, eventId, fromStatus, toStatus) {
  store.appendLifecycleEvent({
    schema: 'eve-atelier-operator-lifecycle-event/v1',
    eventId,
    packRef: { packId: ref.packId, version: ref.version, digest: ref.digest },
    fromStatus,
    toStatus,
    evidenceRefs: [`evidence:${eventId}`],
    actor: humanActor(),
    createdAt: '2026-08-31T21:21:00+08:00',
  });
}

test('compiles an uncalibrated semantic directive only to a non-executable plan', () => {
  const store = new OperatorRegistryStore({ path: ':memory:' });
  try {
    const ref = register(store);
    transition(store, ref, 'lifecycle:experimental', 'DRAFT', 'EXPERIMENTAL_UNCALIBRATED');
    const directive = validDirective();
    directive.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };

    const plan = compileSemanticDirective({ store, directive });

    assert.equal(plan.schema, 'eve-atelier-operator-plan/v1');
    assert.equal(plan.status, 'UNVERIFIED');
    assert.equal(plan.executable, false);
    assert.deepEqual(plan.blockers, ['operator_pack_not_active']);
    assert.deepEqual(plan.packRef, directive.packRef);
    assert.deepEqual(plan.steps.map(step => step.operatorRef), [
      { operatorId: 'visual.op.generative.generate_variation', version: '1.0.0' },
    ]);
    assert.equal('provider' in plan, false);
    assert.equal('acceptance' in plan, false);
    assert.equal('promotion' in plan, false);
  } finally {
    store.close();
  }
});

test('projects lifecycle maturity into BLOCKED, READY, and DEPRECATED plans', () => {
  const store = new OperatorRegistryStore({ path: ':memory:' });
  try {
    const ref = register(store);
    const directive = validDirective();
    directive.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };

    assert.deepEqual(
      compileSemanticDirective({ store, directive }).blockers,
      ['operator_pack_draft'],
    );
    transition(store, ref, 'lifecycle:exp-ready-test', 'DRAFT', 'EXPERIMENTAL_UNCALIBRATED');
    transition(store, ref, 'lifecycle:cal-ready-test', 'EXPERIMENTAL_UNCALIBRATED', 'CALIBRATED');
    transition(store, ref, 'lifecycle:active-ready-test', 'CALIBRATED', 'ACTIVE');
    const ready = compileSemanticDirective({ store, directive });
    assert.equal(ready.status, 'READY');
    assert.equal(ready.executable, true);
    assert.deepEqual(ready.blockers, []);

    transition(store, ref, 'lifecycle:deprecated-ready-test', 'ACTIVE', 'DEPRECATED');
    const deprecated = compileSemanticDirective({ store, directive });
    assert.equal(deprecated.status, 'BLOCKED');
    assert.equal(deprecated.executable, false);
    assert.deepEqual(deprecated.blockers, ['operator_pack_deprecated']);
  } finally {
    store.close();
  }
});

test('fails closed on unsupported axes, values, effects, locks, rules, and pack identity', () => {
  const cases = [
    [
      'unknown axis',
      'directive',
      ({ directive }) => { directive.axisChanges[0].axisId = 'semantic.axis.missing'; },
      /semantic_axis_not_supported:semantic.axis.missing/,
    ],
    [
      'out-of-range value',
      'directive',
      ({ directive }) => { directive.axisChanges[0].value = 1.5; },
      /semantic_axis_value_invalid:semantic.axis.example.intensity/,
    ],
    [
      'unsupported effect',
      'directive',
      ({ directive }) => { directive.axisChanges[0].mode = 'INCREASE'; },
      /semantic_effect_not_supported:semantic.axis.example.intensity:INCREASE/,
    ],
    [
      'missing required lock',
      'directive',
      ({ directive }) => { directive.locks = []; },
      /semantic_required_lock_missing:semantic.lock.example.identity/,
    ],
    [
      'provider-bound source',
      'directive',
      ({ directive }) => {
        directive.operatorRef = { operatorId: 'visual.op.raster.resize', version: '1.0.0' };
      },
      /semantic_operator_must_be_compile_only/,
    ],
    [
      'wrong pack digest',
      'directive',
      ({ directive }) => { directive.packRef.digest = 'f'.repeat(64); },
      /operator_pack_digest_mismatch/,
    ],
    [
      'missing compiler rule',
      'pack',
      ({ pack }) => { pack.compilerRules = []; },
      /semantic_compiler_rule_not_found/,
    ],
  ];

  for (const [name, target, mutate, expected] of cases) {
    const store = new OperatorRegistryStore({ path: ':memory:' });
    try {
      const pack = validPack();
      if (target === 'pack') mutate({ pack });
      const ref = store.registerPack({
        pack,
        proposer: humanActor(),
        registeredAt: '2026-08-31T21:20:00+08:00',
      });
      const directive = validDirective();
      directive.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
      if (target === 'directive') mutate({ directive });
      assert.throws(() => compileSemanticDirective({ store, directive }), expected, name);
    } finally {
      store.close();
    }
  }
});
