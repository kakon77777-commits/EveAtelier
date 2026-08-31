import test from 'node:test';
import assert from 'node:assert/strict';
import { OperatorRegistryStore } from '../../src/operator-runtime/registry-store.js';
import { validExperienceEvent, validPack } from './helpers.js';

function humanActor() {
  return { kind: 'HUMAN', id: 'human:local-reviewer' };
}

function register(store, proposer = humanActor()) {
  return store.registerPack({
    pack: validPack(),
    proposer,
    registeredAt: '2026-08-31T21:10:00+08:00',
  });
}

function lifecycleEvent(ref, {
  eventId,
  fromStatus,
  toStatus,
  actor = humanActor(),
  evidenceRefs = ['evidence:review:001'],
} = {}) {
  return {
    schema: 'eve-atelier-operator-lifecycle-event/v1',
    eventId,
    packRef: { packId: ref.packId, version: ref.version, digest: ref.digest },
    fromStatus,
    toStatus,
    evidenceRefs,
    actor,
    createdAt: '2026-08-31T21:12:00+08:00',
  };
}

test('registers an immutable pack idempotently and rejects same-version drift', () => {
  const store = new OperatorRegistryStore({ path: ':memory:' });
  try {
    const first = store.registerPack({
      pack: validPack(),
      proposer: humanActor(),
      registeredAt: '2026-08-31T21:10:00+08:00',
    });
    assert.equal(first.status, 'DRAFT');
    assert.equal(first.digest.length, 64);
    assert.deepEqual(store.registerPack({
      pack: validPack(),
      proposer: humanActor(),
      registeredAt: '2026-08-31T21:10:00+08:00',
    }), first);
    assert.deepEqual(store.getPack(first), validPack());

    const drifted = validPack();
    drifted.description = 'Different bytes under the same version.';
    assert.throws(
      () => store.registerPack({
        pack: drifted,
        proposer: humanActor(),
        registeredAt: '2026-08-31T21:11:00+08:00',
      }),
      /operator_pack_version_conflict/,
    );
  } finally {
    store.close();
  }
});

test('keeps lifecycle transitions append-only, evidence-gated, and human-authorized', () => {
  const store = new OperatorRegistryStore({ path: ':memory:' });
  try {
    const ref = register(store, { kind: 'AI', id: 'ai:operator-proposer' });
    assert.equal(store.getStatus(ref), 'DRAFT');

    assert.throws(() => store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:ai-attempt',
      fromStatus: 'DRAFT',
      toStatus: 'EXPERIMENTAL_UNCALIBRATED',
      actor: { kind: 'AI', id: 'ai:operator-proposer' },
    })), /ai_lifecycle_transition_forbidden/);
    assert.equal(store.getStatus(ref), 'DRAFT');

    assert.throws(() => store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:no-evidence',
      fromStatus: 'DRAFT',
      toStatus: 'EXPERIMENTAL_UNCALIBRATED',
      evidenceRefs: [],
    })), /lifecycle_evidence_required/);

    store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:experimental',
      fromStatus: 'DRAFT',
      toStatus: 'EXPERIMENTAL_UNCALIBRATED',
    }));
    assert.equal(store.getStatus(ref), 'EXPERIMENTAL_UNCALIBRATED');

    assert.throws(() => store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:system-calibration',
      fromStatus: 'EXPERIMENTAL_UNCALIBRATED',
      toStatus: 'CALIBRATED',
      actor: { kind: 'SYSTEM', id: 'system:calibration-runner' },
    })), /human_lifecycle_authority_required:CALIBRATED/);

    store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:calibrated',
      fromStatus: 'EXPERIMENTAL_UNCALIBRATED',
      toStatus: 'CALIBRATED',
    }));
    store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:active',
      fromStatus: 'CALIBRATED',
      toStatus: 'ACTIVE',
    }));
    assert.equal(store.getStatus(ref), 'ACTIVE');

    assert.throws(() => store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:backwards',
      fromStatus: 'ACTIVE',
      toStatus: 'CALIBRATED',
    })), /invalid_lifecycle_transition:ACTIVE->CALIBRATED/);
  } finally {
    store.close();
  }
});

test('stores exact experience evidence and makes every registry table append-only', () => {
  const store = new OperatorRegistryStore({ path: ':memory:' });
  try {
    const ref = register(store);
    store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:experimental-for-immutability',
      fromStatus: 'DRAFT',
      toStatus: 'EXPERIMENTAL_UNCALIBRATED',
    }));
    const experience = validExperienceEvent();
    experience.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };

    assert.deepEqual(store.appendExperience(experience), experience);
    assert.deepEqual(
      store.listExperience({ operatorId: 'visual.op.raster.resize' }),
      [experience],
    );

    const unknownOperator = validExperienceEvent();
    unknownOperator.eventId = 'experience:unknown-operator';
    unknownOperator.packRef = structuredClone(experience.packRef);
    unknownOperator.operatorRef.operatorId = 'visual.op.missing';
    assert.throws(
      () => store.appendExperience(unknownOperator),
      /operator_experience_operator_not_found/,
    );

    const mutations = [
      'UPDATE operator_packs SET proposer_id = \'changed\'',
      'DELETE FROM operator_packs',
      'UPDATE registry_events SET actor_id = \'changed\'',
      'DELETE FROM registry_events',
      'UPDATE experience_events SET outcome = \'FAILED\'',
      'DELETE FROM experience_events',
    ];
    for (const statement of mutations) {
      assert.throws(() => store.database.exec(statement), /append_only_(?:update|delete)_forbidden/);
    }
  } finally {
    store.close();
  }
});
