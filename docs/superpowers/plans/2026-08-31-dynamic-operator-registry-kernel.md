# Dynamic Operator Registry Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an executable, versioned, evidence-driven Operator Meta-Runtime whose semantic axes and operator families load dynamically while lifecycle authority and historical definitions remain fail-closed.

**Architecture:** A strict provider-neutral contract layer validates immutable OperatorPacks and requests. A Node `node:sqlite` append-only registry stores pack versions, lifecycle events, and experience evidence. A semantic compiler emits provider-neutral plans, while a capability matcher binds only ACTIVE executable operators to compatible providers.

**Tech Stack:** Node.js 24 ESM, built-in `node:sqlite`, built-in `node:test`, SHA-256 canonical JSON digests, existing `PillowRasterProvider`.

**Spec:** `docs/superpowers/specs/2026-08-31-dynamic-operator-registry-kernel-design.md`

## Global Constraints

- Use no subagent during implementation; at most one read-only verifier after completion.
- Keep `OperatorDefinition != ProviderCapability != Provider Parameters`.
- Definitions are immutable; changes create a new semantic version.
- AI-declared actors may propose DRAFT packs and experience events but cannot create lifecycle transitions.
- No Workbench promotion, MRMIC mutation, MOD generation, new model, LoRA, ControlNet, RVGR L1/L2, SEDB adapter, or UI.
- Operator packs, fixtures, receipts, and database rows must not contain credentials, private image paths, or image bytes.
- All new behavior follows RED -> GREEN TDD and ends with focused plus full regression evidence.

---

### Task 1: Strict Dynamic Contracts and Canonical Digests

**Files:**
- Create: `src/operator-runtime/canonical.js`
- Create: `src/operator-runtime/contracts.js`
- Create: `tests/operator-runtime/contracts.test.js`

**Interfaces:**
- Produces: `canonicalJson(value): string`
- Produces: `digestDefinition(value): string`
- Produces: `validateOperatorPack(value): { ok: true } | { ok: false, reason: string }`
- Produces: `validateSemanticDirective(value)`
- Produces: `validateProviderCapabilityManifest(value)`
- Produces: `validateOperatorInvocation(value)`
- Produces: `validateExperienceEvent(value)`
- Later tasks consume the exact validated shapes and digest.

- [ ] **Step 1: Write failing canonicalization and pack validation tests**

```js
test('canonical digest is stable across object key order', () => {
  assert.equal(
    digestDefinition({ b: 2, a: { y: 2, x: 1 } }),
    digestDefinition({ a: { x: 1, y: 2 }, b: 2 }),
  );
});

test('accepts new semantic axes from data without changing the kernel', () => {
  const pack = validPack();
  pack.axes.push({
    axisId: 'semantic.axis.example.new-theory',
    description: 'Loaded entirely from the pack.',
    valueSchema: { kind: 'SCALAR', min: 0, max: 1 },
  });
  assert.deepEqual(validateOperatorPack(pack), { ok: true });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/operator-runtime/contracts.test.js`

Expected: module-not-found failure for `src/operator-runtime/contracts.js` or missing exports.

- [ ] **Step 3: Implement canonical JSON and exact-field validators**

```js
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digestDefinition(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
```

Validators must reject unknown fields, provider/model/prompt/workflow keys in canonical definitions, duplicate IDs, invalid axis schemas, dangling axis/lock/compiler references, promotion authority, invalid parameter schemas, absolute local paths, and non-SHA artifact identities.

- [ ] **Step 4: Add negative bypass tests**

Cover at minimum:

```text
providerParameters
workflow
modelId
prompt
promotion authority
duplicate axis ID
dangling lock axis
dangling compiler output operator
invalid SCALAR / ENUM / VECTOR values
unknown request fields
```

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/operator-runtime/contracts.test.js`

Expected: all Task 1 tests PASS.

```powershell
git add -- src/operator-runtime/canonical.js src/operator-runtime/contracts.js tests/operator-runtime/contracts.test.js
git commit -m "feat: add dynamic operator pack contracts"
```

---

### Task 2: Append-only SQLite Registry and Lifecycle Gate

**Files:**
- Create: `src/operator-runtime/registry-store.js`
- Create: `tests/operator-runtime/registry-store.test.js`

**Interfaces:**
- Consumes: `digestDefinition`, `validateOperatorPack`, `validateExperienceEvent`
- Produces: `new OperatorRegistryStore({ path?, now? })`
- Produces: `registerPack({ pack, proposer, registeredAt? }): { packId, version, digest, status }`
- Produces: `getPack({ packId, version, digest? }): object`
- Produces: `getStatus({ packId, version, digest }): string`
- Produces: `appendLifecycleEvent(event): object`
- Produces: `appendExperience(event): object`
- Produces: `listExperience({ operatorId?, packId? }): object[]`
- Produces: `close(): void`

- [ ] **Step 1: Write failing registration, immutability, and lifecycle tests**

```js
test('same pack is idempotent but same version with different bytes conflicts', () => {
  const store = memoryStore();
  const first = store.registerPack({ pack: validPack(), proposer: humanActor() });
  assert.deepEqual(store.registerPack({ pack: validPack(), proposer: humanActor() }), first);
  const drifted = validPack();
  drifted.description = 'different definition';
  assert.throws(
    () => store.registerPack({ pack: drifted, proposer: humanActor() }),
    /operator_pack_version_conflict/,
  );
});

test('AI can propose but cannot promote a pack', () => {
  const store = memoryStore();
  const ref = store.registerPack({ pack: validPack(), proposer: aiActor() });
  assert.throws(() => store.appendLifecycleEvent({
    ...transition(ref, 'DRAFT', 'EXPERIMENTAL_UNCALIBRATED'),
    actor: aiActor(),
  }), /ai_lifecycle_transition_forbidden/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/operator-runtime/registry-store.test.js`

Expected: module-not-found failure for `registry-store.js`.

- [ ] **Step 3: Implement database schema and append-only triggers**

```sql
CREATE TABLE operator_packs (... PRIMARY KEY(pack_id, version));
CREATE TABLE registry_events (... PRIMARY KEY(event_id));
CREATE TABLE experience_events (... PRIMARY KEY(event_id));

CREATE TRIGGER operator_packs_no_update BEFORE UPDATE ON operator_packs
BEGIN SELECT RAISE(ABORT, 'append_only_update_forbidden'); END;
CREATE TRIGGER operator_packs_no_delete BEFORE DELETE ON operator_packs
BEGIN SELECT RAISE(ABORT, 'append_only_delete_forbidden'); END;
```

Create corresponding triggers for all three tables. Use prepared statements only; store canonical JSON and parse on read.

- [ ] **Step 4: Implement lifecycle transitions and evidence gates**

Enforce the exact transition table from the spec. Require non-empty evidence refs for every event; require declared HUMAN actor for `CALIBRATED` and `ACTIVE`; forbid all lifecycle events from AI actors.

- [ ] **Step 5: Add direct SQL mutation and experience-query tests**

Tests must prove `UPDATE` and `DELETE` fail on every table and that experience events retain exact pack/operator/provider/evaluation identities without image bytes.

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test tests/operator-runtime/registry-store.test.js`

Expected: all Task 2 tests PASS.

```powershell
git add -- src/operator-runtime/registry-store.js tests/operator-runtime/registry-store.test.js
git commit -m "feat: add append-only operator registry store"
```

---

### Task 3: Semantic Directive Compiler

**Files:**
- Create: `src/operator-runtime/semantic-compiler.js`
- Create: `tests/operator-runtime/semantic-compiler.test.js`

**Interfaces:**
- Consumes: `OperatorRegistryStore.getPack/getStatus`
- Consumes: `validateSemanticDirective`
- Produces: `compileSemanticDirective({ store, directive }): OperatorPlan`

`OperatorPlan` exact output:

```js
{
  schema: 'eve-atelier-operator-plan/v1',
  planId: `plan:${directive.directiveId}`,
  sourceDirectiveId: directive.directiveId,
  packRef: structuredClone(directive.packRef),
  status: 'BLOCKED' | 'UNVERIFIED' | 'READY',
  executable: boolean,
  blockers: [],
  steps: [{
    stepId: 'step:1',
    operatorRef: { operatorId, version },
    target: structuredClone(directive.target),
    expectedRevision: directive.expectedRevision,
    constraints: {
      axisChanges: structuredClone(directive.axisChanges),
      locks: structuredClone(directive.locks),
    },
  }],
}
```

- [ ] **Step 1: Write failing status and reference-integrity tests**

```js
test('uncalibrated semantic pack compiles only to a non-executable plan', () => {
  const plan = compileSemanticDirective({ store, directive: validDirective(ref) });
  assert.equal(plan.status, 'UNVERIFIED');
  assert.equal(plan.executable, false);
  assert.deepEqual(plan.blockers, ['operator_pack_not_active']);
});
```

Also cover DRAFT, ACTIVE, DEPRECATED, wrong digest, unknown axis, wrong value type/range, missing required lock, unsupported effect, and missing compiler rule.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/operator-runtime/semantic-compiler.test.js`

Expected: module-not-found failure for `semantic-compiler.js`.

- [ ] **Step 3: Implement strict directive resolution and plan projection**

Resolve all definitions from the exact pack snapshot. Do not copy unknown input fields. Do not create provider bindings or provider parameters. Lifecycle status determines only plan readiness, never acceptance.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test tests/operator-runtime/semantic-compiler.test.js`

Expected: all Task 3 tests PASS.

```powershell
git add -- src/operator-runtime/semantic-compiler.js tests/operator-runtime/semantic-compiler.test.js
git commit -m "feat: compile versioned semantic directives"
```

---

### Task 4: Capability Matcher and Executable Green Control

**Files:**
- Create: `src/operator-runtime/runtime.js`
- Create: `tests/operator-runtime/runtime.test.js`

**Interfaces:**
- Consumes: `validateProviderCapabilityManifest`, `validateOperatorInvocation`
- Consumes: exact ACTIVE pack/operator from `OperatorRegistryStore`
- Produces: `matchProviderCapability({ manifests, operator, policy }): manifest`
- Produces: `executeInvocation({ store, manifests, providers, invocation, now? }): Promise<ProviderReceipt>`

- [ ] **Step 1: Write failing provider matching tests**

```js
test('filters on exact version, privacy, availability, and capabilities before ranking', () => {
  const selected = matchProviderCapability({
    manifests,
    operator: resizeOperator,
    policy: { allowedPrivacy: ['LOCAL'], requiredCapabilities: ['raster.resize'] },
  });
  assert.equal(selected.providerId, 'provider:pillow-reference');
});
```

Add negative cases for unavailable, remote privacy, missing capability, wrong version, provider object identity mismatch, uncalibrated pack, compile-only operator, unknown params, invalid param type/range, and promotion authority.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/operator-runtime/runtime.test.js`

Expected: module-not-found failure for `runtime.js`.

- [ ] **Step 3: Implement stable matching and exact invocation validation**

Ranking order:

```text
evidenceLevel: PRODUCTION_OBSERVED > RIGHTS_CLEAR_REAL > PRIVATE_RESEARCH_AUTHORIZED > CONTRACT_TESTED > FIXTURE
latencyRank ascending
costRank ascending
providerId lexical tie-break
```

Do not catch provider failures as acceptance; return/throw execution state only.

- [ ] **Step 4: Add real Pillow resize execution test**

Create a synthetic 16x16 source with `tests/helpers/fixture-image.py`, register and activate the synthetic core pack, execute `visual.op.raster.resize`, and assert:

```text
output exists
metadata width=4 height=5
receipt exact pack/operator/provider identity
Workbench untouched
no acceptance/promotion fields
```

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test tests/operator-runtime/runtime.test.js`

Expected: all Task 4 tests PASS.

```powershell
git add -- src/operator-runtime/runtime.js tests/operator-runtime/runtime.test.js
git commit -m "feat: execute active operators through capability matching"
```

---

### Task 5: Public-safe Fixtures, Documentation, and Full Verification

**Files:**
- Create: `fixtures/operator_runtime/core-pack.example.json`
- Create: `fixtures/operator_runtime/provider-capabilities.example.json`
- Create: `fixtures/operator_runtime/README.md`
- Create: `tests/operator-runtime/fixtures.test.js`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-31-dynamic-operator-registry-kernel-design.md`

**Interfaces:**
- Fixtures exercise Task 1–4 public APIs with synthetic IDs and hashes.
- README records evidence and non-claims.

- [ ] **Step 1: Write failing fixture validation test**

```js
test('tracked Phase 2A fixtures are public-safe and executable', async () => {
  const pack = await readJson('fixtures/operator_runtime/core-pack.example.json');
  const manifest = await readJson('fixtures/operator_runtime/provider-capabilities.example.json');
  assert.deepEqual(validateOperatorPack(pack), { ok: true });
  assert.deepEqual(validateProviderCapabilityManifest(manifest), { ok: true });
  assert.doesNotMatch(JSON.stringify({ pack, manifest }), /[A-Za-z]:[\\/]/);
});
```

- [ ] **Step 2: Run fixture test and verify RED**

Run: `node --test tests/operator-runtime/fixtures.test.js`

Expected: ENOENT for the missing fixture.

- [ ] **Step 3: Add synthetic fixtures and operator-runtime README**

The pack must include:

- one dynamic example semantic axis;
- one required preservation lock;
- one `COMPILE_ONLY` semantic variant;
- one `PROVIDER_BOUND` `visual.op.raster.resize` variant;
- one compiler rule;
- no private paths, provider parameters, image bytes, rights claims, or calibrated claims.

- [ ] **Step 4: Update top-level evidence and non-claims**

Document:

```text
Dynamic Operator Registry Kernel implemented
SQLite metadata/evidence only
semantic learning evidence scaffold, not calibrated learning
no MOD generation / Workbench promotion / MRMIC mutation
```

- [ ] **Step 5: Run focused and full verification**

Run:

```powershell
node --test tests/operator-runtime/*.test.js
npm run check
npm test
git diff --check
```

Expected: 0 failures; only the existing explicit opt-in live-MRMIC skip remains.

- [ ] **Step 6: Commit**

```powershell
git add -- fixtures/operator_runtime tests/operator-runtime README.md docs/superpowers/specs/2026-08-31-dynamic-operator-registry-kernel-design.md
git commit -m "docs: record dynamic operator kernel evidence"
```

---

## Plan Self-Review

- Spec coverage: Tasks 1–5 cover contracts, immutable versioning, lifecycle authority, SQLite evidence, semantic compilation, provider matching, executable green control, public fixtures, and non-claims.
- Scope: SEDB, ArtDocument/Region, UI, generative providers, learning-policy optimization, and seed registry remain explicitly outside Phase 2A.
- Type consistency: all later tasks consume the exact public signatures declared by earlier tasks.
- Placeholder scan: no implementation placeholders or unspecified error-handling steps remain.
