import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperatorRegistryStore } from '../../src/operator-runtime/registry-store.js';
import { validExperienceEvent, validPack, validProviderManifest } from './helpers.js';

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
    assert.equal(register(store).status, 'ACTIVE');

    assert.throws(() => store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:backwards',
      fromStatus: 'ACTIVE',
      toStatus: 'CALIBRATED',
    })), /invalid_lifecycle_transition:ACTIVE->CALIBRATED/);
  } finally {
    store.close();
  }
});

test('stores exact experience evidence and makes every registry table append-only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-operator-append-only-'));
  const databasePath = join(directory, 'registry.sqlite');
  const store = new OperatorRegistryStore({ path: databasePath });
  let attacker;
  try {
    const ref = register(store);
    store.appendLifecycleEvent(lifecycleEvent(ref, {
      eventId: 'lifecycle:experimental-for-immutability',
      fromStatus: 'DRAFT',
      toStatus: 'EXPERIMENTAL_UNCALIBRATED',
    }));
    const experience = validExperienceEvent();
    experience.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };

    assert.throws(
      () => store.appendExperience(experience),
      /operator_experience_runtime_manifest_required/,
    );
    assert.deepEqual(store.appendExperience(experience, {
      providerManifest: validProviderManifest(),
    }), experience);
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
    attacker = new DatabaseSync(databasePath);
    for (const statement of mutations) {
      assert.throws(() => attacker.exec(statement), /append_only_(?:update|delete)_forbidden/);
    }
  } finally {
    attacker?.close();
    store.close();
  }
});

test('rejects INSERT OR REPLACE attacks against every immutable registry key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eve-operator-registry-'));
  const databasePath = join(directory, 'registry.sqlite');
  const store = new OperatorRegistryStore({ path: databasePath });
  let attacker;
  try {
    const ref = register(store);
    const lifecycle = lifecycleEvent(ref, {
      eventId: 'lifecycle:replace-guard',
      fromStatus: 'DRAFT',
      toStatus: 'EXPERIMENTAL_UNCALIBRATED',
    });
    store.appendLifecycleEvent(lifecycle);
    const experience = validExperienceEvent();
    experience.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
    store.appendExperience(experience, { providerManifest: validProviderManifest() });

    attacker = new DatabaseSync(databasePath);
    const attacks = [
      [
        `INSERT OR REPLACE INTO operator_packs (
          pack_id, version, digest, definition_json, registered_at, proposer_kind, proposer_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ref.packId, ref.version, 'f'.repeat(64), '{}', lifecycle.createdAt, 'AI', 'ai:replace'],
      ],
      [
        `INSERT OR REPLACE INTO registry_events (
          event_id, pack_id, version, digest, from_status, to_status,
          evidence_refs_json, actor_kind, actor_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          lifecycle.eventId,
          ref.packId,
          ref.version,
          ref.digest,
          'DRAFT',
          'ACTIVE',
          '["fake"]',
          'AI',
          'ai:replace',
          lifecycle.createdAt,
        ],
      ],
      [
        `INSERT OR REPLACE INTO experience_events (
          event_id, pack_id, version, digest, operator_id, operator_version,
          provider_id, provider_version, semantic_context_json, input_hashes_json,
          output_hashes_json, outcome, evaluation_refs_json, human_preference_ref,
          evidence_class, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          experience.eventId,
          ref.packId,
          ref.version,
          ref.digest,
          experience.operatorRef.operatorId,
          experience.operatorRef.version,
          'provider:fake',
          '9.9',
          '{"axisChanges":[],"lockIds":[]}',
          '[]',
          '[]',
          'COMPLETED',
          '[]',
          null,
          'PRODUCTION_OBSERVED',
          experience.occurredAt,
        ],
      ],
    ];
    for (const [sql, params] of attacks) {
      assert.throws(
        () => attacker.prepare(sql).run(...params),
        /append_only_replace_forbidden/,
      );
    }
    assert.equal(store.getPack(ref).description, validPack().description);
    assert.equal(store.getStatus(ref), 'EXPERIMENTAL_UNCALIBRATED');
    assert.deepEqual(store.listExperience({ operatorId: experience.operatorRef.operatorId }), [experience]);
  } finally {
    attacker?.close();
    store.close();
  }
});

test('rejects dangling semantic context and provider claims in experience proposals', () => {
  const cases = [
    [
      'unknown axis',
      event => {
        event.semanticContext.axisChanges = [
          { axisId: 'semantic.axis.missing', mode: 'SET', value: 0.5 },
        ];
      },
      /operator_experience_axis_not_found:semantic.axis.missing/,
    ],
    [
      'invalid axis value',
      event => {
        event.semanticContext.axisChanges = [
          { axisId: 'semantic.axis.example.intensity', mode: 'SET', value: 2 },
        ];
      },
      /operator_experience_axis_value_invalid:semantic.axis.example.intensity/,
    ],
    [
      'unknown lock',
      event => { event.semanticContext.lockIds = ['semantic.lock.missing']; },
      /operator_experience_lock_not_found:semantic.lock.missing/,
    ],
    [
      'AI provider claim',
      event => {
        event.provenance = { kind: 'AI', id: 'ai:operator-learner' };
        event.providerRef = { providerId: 'provider:asserted', providerVersion: '9.9' };
      },
      /operator_experience_provider_ref_forbidden_for_proposal/,
    ],
  ];
  for (const [name, mutate, expected] of cases) {
    const store = new OperatorRegistryStore({ path: ':memory:' });
    try {
      const ref = register(store);
      const event = validExperienceEvent();
      event.eventId = `experience:${name.replaceAll(' ', '-')}`;
      event.packRef = { packId: ref.packId, version: ref.version, digest: ref.digest };
      mutate(event);
      assert.throws(() => store.appendExperience(event), expected, name);
    } finally {
      store.close();
    }
  }
});
