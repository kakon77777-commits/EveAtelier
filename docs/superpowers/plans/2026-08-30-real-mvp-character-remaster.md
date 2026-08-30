# EveAtelier Real MVP Phase 1 Character Remaster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one fail-closed, resumable Character Remaster flow from typed real assets through real generation, independent evaluation, human review, Workbench promotion, and live MRMIC projection.

**Architecture:** Keep `EveAtelierWorkbench` as version-state authority, compile provider-neutral requests inside isolated provider adapters, and keep MRMIC as Canvas/projection authority. Normal tests use deterministic local fixtures and HTTP doubles; real provider, real evaluator, real human review, and live MRMIC evidence are opt-in and classified separately.

**Tech Stack:** Node.js ESM on Node 22.5+, built-in `node:test`, Python 3 subprocess providers, Pillow/NumPy, optional Transformers/Torch image embedding, ComfyUI HTTP API, MRMIC Phase 13 HTTP contracts.

**Spec:** `docs/superpowers/specs/2026-08-30-real-mvp-character-remaster-design.md`

## Global Constraints

- `Operator != Provider != Provider Parameter Set`.
- `Provider Receipt != Visual Acceptance`.
- `Candidate != Current Version`.
- `Execution Success != Canonical Promotion`.
- `MRMIC Projection != Provider Asset Ownership`.
- `AADS / Workbench Belief != Canonical Workbench State`.
- Stale revisions fail closed with `STALE_INPUT`.
- Source assets are byte-preserving by default.
- ComfyUI remains an independent external GPL provider; no ComfyUI source enters EveAtelier core.
- Diffusers code and model weights have separate license evidence.
- No model package or model weight is downloaded without explicit model identity, source, license, storage, VRAM, and user approval.
- Private source/reference bytes, local absolute paths, credentials, and bearer tokens are not committed.
- Fixture, mock, and automated review evidence cannot satisfy Real MVP PASS.
- No production code is written before its focused test has been observed failing.
- Execution is inline in this task; no subagents are used.

---

### Task 1: Restore a cross-platform validation gate

**Files:**
- Create: `scripts/check.mjs`
- Create: `tests/check-script.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: repository `src/**/*.js`, `scripts/**/*.mjs`, and `providers/python/**/*.py`.
- Produces: `npm run check`, returning exit 0 only after JavaScript syntax and Python bytecode compilation both pass.

- [ ] **Step 1: Write a failing shell-independence test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('the repository check runs without Unix find or xargs', () => {
  const result = spawnSync(process.execPath, ['scripts/check.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /checked_js=\d+ checked_python=true/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/check-script.test.js`
Expected: FAIL because `scripts/check.mjs` does not exist.

- [ ] **Step 3: Implement the platform-neutral checker**

`scripts/check.mjs` recursively enumerates regular `.js` and `.mjs` files under `src` and `scripts`, invokes `process.execPath --check` once per file without a shell, then invokes `python3 -m compileall -q providers/python` and falls back to `python` only when process creation returns `ENOENT`.

The CLI success line is exactly:

```text
checked_js=<integer> checked_python=true
```

Change the package script to:

```json
"check": "node scripts/check.mjs"
```

- [ ] **Step 4: Verify GREEN and baseline retention**

Run: `node --test tests/check-script.test.js`
Expected: PASS.

Run: `npm run check`
Expected: exit 0 and the success line.

Run: `npm test`
Expected: all original 20 tests plus the new test pass.

- [ ] **Step 5: Commit**

```powershell
git add -- package.json scripts/check.mjs tests/check-script.test.js
git commit -m "fix: make repository validation cross-platform"
```

---

### Task 2: Add typed reference binding and provider-neutral generation requests

**Files:**
- Create: `src/character-remaster/contracts.js`
- Create: `tests/real-mvp/character-remaster-contracts.test.js`
- Create: `fixtures/real_mvp/character_remaster/README.md`
- Create: `fixtures/real_mvp/character_remaster/source/.gitignore`
- Create: `fixtures/real_mvp/character_remaster/reference/.gitignore`
- Create: `fixtures/real_mvp/character_remaster/intent/task_001.example.json`
- Create: `fixtures/real_mvp/character_remaster/expected/task_001_thresholds.example.json`

**Interfaces:**
- Consumes: `bindReferenceRoles({ sourceAsset, references })` where each reference is `{ path, role }`.
- Produces: `validateCharacterRemasterIntent(intent)`, `bindReferenceRoles(input)`, and `buildGenerationRequest({ intent, assets, candidateIndex, outputPath })`.
- `buildGenerationRequest` returns `{ operationId, operatorId, source, references, intentText, constraints, seed, outputPath }` with `operatorId: 'visual.op.generative.generate_variation'`.

- [ ] **Step 1: Write failing contract tests**

Cover these exact behaviors:

```js
assert.equal(validateCharacterRemasterIntent(validIntent).ok, true);
assert.deepEqual(validateCharacterRemasterIntent({ ...validIntent, candidateCount: 1 }), {
  ok: false,
  reason: 'candidate_count_must_be_2_to_4',
});
assert.throws(
  () => bindReferenceRoles({ sourceAsset, references: referencesWithoutNegative }),
  /missing_reference_role:negative_reference/,
);
assert.equal(request.operatorId, 'visual.op.generative.generate_variation');
assert.equal(request.source.sha256, sha256OfSource);
assert.equal(new Set(request.references.map(item => item.role)).size, request.references.length);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/real-mvp/character-remaster-contracts.test.js`
Expected: FAIL with module-not-found for `src/character-remaster/contracts.js`.

- [ ] **Step 3: Implement strict contracts and hashing**

Required roles:

```js
export const REQUIRED_REFERENCE_ROLES = Object.freeze([
  'line_reference',
  'color_reference',
  'negative_reference',
]);
```

Optional roles are `quality_reference` and `identity_reference`. Reject duplicate roles, missing files, empty intent text, non-`character_remaster` goals, `humanReviewRequired !== true`, and candidate counts outside 2-4. Hash source/reference bytes with SHA-256 during binding.

Seeds are derived deterministically as `baseSeed + candidateIndex`; the candidate index must be an integer from zero through `candidateCount - 1`.

- [ ] **Step 4: Add privacy-preserving fixture structure**

Each asset directory `.gitignore` contains:

```gitignore
*
!.gitignore
```

The example intent uses logical relative paths and `candidateCount: 2`. The example threshold file has `calibrationStatus: "EXAMPLE_UNCALIBRATED"`, so it cannot produce an accepting verdict.

- [ ] **Step 5: Verify contracts and full regression**

Run: `node --test tests/real-mvp/character-remaster-contracts.test.js`
Expected: PASS.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src/character-remaster/contracts.js tests/real-mvp/character-remaster-contracts.test.js fixtures/real_mvp/character_remaster
git commit -m "feat: add typed character remaster requests"
```

---

### Task 3: Require independent evaluation and a durable human review before promotion

**Files:**
- Create: `src/character-remaster/evaluation.js`
- Create: `src/character-remaster/human-review.js`
- Create: `tests/real-mvp/character-remaster-evaluation.test.js`
- Create: `tests/real-mvp/workbench-review.test.js`
- Modify: `src/workbench.js`

**Interfaces:**
- Consumes: `decideCharacterRemasterVerdict({ artifact, scores, thresholds, evaluator })`.
- Produces: `{ verdict, scores, thresholds, evaluator, evidence }`.
- Consumes: `validateHumanReview(review, candidateVersionId)`.
- Adds Workbench methods `recordHumanReview({ documentId, versionId, review })`, `exportState()`, and `EveAtelierWorkbench.fromState(state)`.

- [ ] **Step 1: Write failing evaluation tests**

Exercise all fail-closed rules:

```js
assert.equal(decideCharacterRemasterVerdict(uncalibratedEvidence).verdict, 'UNVERIFIED');
assert.equal(decideCharacterRemasterVerdict(lowIdentityEvidence).verdict, 'REPAIR');
assert.equal(decideCharacterRemasterVerdict(negativeViolationEvidence).verdict, 'REJECT');
assert.equal(decideCharacterRemasterVerdict(fullyPassingCalibratedEvidence).verdict, 'ACCEPT');
```

The passing case must include decoded artifact evidence, identity, line, color, style, artifact-quality, and negative-reference scores plus evaluator ID, version, model ID, and `measurement: 'representation_similarity'`.

- [ ] **Step 2: Write failing review and persistence tests**

Use this review shape:

```js
const review = {
  reviewId: 'review:task-001:candidate-1',
  candidateVersionId: candidate.versionId,
  reviewer: { kind: 'human', id: 'local-owner' },
  disposition: 'APPROVE',
  reason: 'Identity and low-saturation wuxia direction are retained.',
  reviewedAt: '2026-08-30T14:00:00.000Z',
  evidenceClass: 'human_observed',
};
```

Verify that an accepted candidate without a review throws `human_approval_required`, a rejected review throws `human_review_rejected`, an approving review permits promotion, and export/import retains versions, hashes, evaluation, review, and `currentVersionId`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/real-mvp/character-remaster-evaluation.test.js tests/real-mvp/workbench-review.test.js`
Expected: FAIL because the new modules/methods do not exist.

- [ ] **Step 4: Implement pure verdict and review validation**

The verdict order is deterministic:

```text
invalid artifact -> REJECT
missing evaluator or uncalibrated thresholds -> UNVERIFIED
negative-reference violation -> REJECT
identity/style/quality below threshold -> REPAIR
all required thresholds pass -> ACCEPT
```

`ACCEPT_WITH_WARNINGS` is allowed only when all hard thresholds pass and a non-empty `warnings` array remains.

Human review allows `APPROVE`, `REJECT`, and `ACCEPT_WITH_WARNINGS`. The reviewer kind must be `human`, reason must be non-empty, candidate ID must match, and the timestamp must parse as a valid ISO instant.

- [ ] **Step 5: Extend Workbench without weakening automatic deterministic paths**

`automatic_deterministic` documents keep the existing validator promotion behavior. `human_required` documents require a stored approving review; the `approvedBy` value is derived as `human:<reviewer.id>` and is not accepted as a substitute input.

Serialize maps as arrays and reconstruct them with duplicate document/version checks. Re-hash every referenced asset during import and reject drift as `asset_hash_mismatch:<versionId>`.

- [ ] **Step 6: Verify GREEN and regression**

Run the two focused test files, then `npm test` and `npm run check`.
Expected: all pass; original background-removal and OFP-lite promotion tests remain green.

- [ ] **Step 7: Commit**

```powershell
git add -- src/character-remaster/evaluation.js src/character-remaster/human-review.js src/workbench.js tests/real-mvp/character-remaster-evaluation.test.js tests/real-mvp/workbench-review.test.js
git commit -m "feat: gate promotion on evaluation and human review"
```

---

### Task 4: Implement pluggable real evaluation and candidate batching

**Files:**
- Create: `providers/python/character_remaster_evaluator.py`
- Create: `src/character-remaster/python-evaluator.js`
- Create: `src/character-remaster/candidate-batch-runner.js`
- Create: `tests/real-mvp/python-evaluator.test.js`
- Create: `tests/real-mvp/candidate-batch-runner.test.js`

**Interfaces:**
- `PythonCharacterRemasterEvaluator.probe()` returns `{ available, evaluatorId, evaluatorVersion, modelId, measurement }` or `{ available: false, reason }`.
- `PythonCharacterRemasterEvaluator.evaluate({ sourcePath, candidatePath, references, thresholds })` returns evidence consumed by `decideCharacterRemasterVerdict`.
- `CandidateBatchRunner.run({ workbench, documentId, intent, assets, provider, evaluator, workingDir })` returns `{ candidates, sourceHashBefore, sourceHashAfter }` and never promotes.

- [ ] **Step 1: Write failing evaluator-boundary tests**

Inject a JSON subprocess invoker into the JavaScript wrapper. Verify an unavailable probe remains unavailable, malformed worker JSON throws `character_evaluator_protocol_error`, and calibrated score evidence is passed to the pure verdict function without provider self-scores.

- [ ] **Step 2: Write a failing batch test**

Use an injected provider that records requests and writes two distinct PNG fixtures. Use an injected evaluator that accepts the first and repairs the second. Verify:

```js
assert.equal(result.candidates.length, 2);
assert.equal(new Set(result.candidates.map(item => item.execution.seed)).size, 2);
assert.equal(workbench.getCurrentVersion(documentId).versionId, sourceVersionId);
assert.equal(result.sourceHashBefore, result.sourceHashAfter);
assert.deepEqual(result.candidates.map(item => item.evaluation.verdict), ['ACCEPT', 'REPAIR']);
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/real-mvp/python-evaluator.test.js tests/real-mvp/candidate-batch-runner.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement the Python evaluator protocol**

The worker accepts JSON actions `probe` and `evaluate`. Imports of Transformers/Torch occur only inside those actions, so offline regression and Python compilation do not require the optional model runtime.

The real path loads an explicitly configured vision model with `local_files_only` true unless a separately authorized run sets `allowDownload: true`. It records model ID, requested revision, resolved revision when available, Transformers version, Torch version, device, and measurement limits.

Scores are computed as follows:

- identity: cosine similarity of normalized source/candidate image embeddings;
- role-specific positive reference similarity: cosine similarity for line, color, quality, and identity references;
- negative-reference similarity: maximum cosine similarity across negative references;
- color alignment: intersection of normalized per-channel histograms;
- line alignment: cosine similarity of normalized grayscale gradient-magnitude histograms;
- artifact quality: deterministic decode, non-empty area, dimensions, and finite-pixel checks.

The report states that embeddings measure representation similarity and are not exact identity proof.

- [ ] **Step 5: Implement the batch runner**

For every candidate, call `provider.generateVariation(request)`, validate the standardized provider result, compute output SHA-256 and parameter digest, stage it with `UNVERIFIED`, then record independent evaluator output. Preserve the source hash before and after the batch and throw `source_asset_mutated` on drift.

Do not invoke `promoteCandidate` in this component.

- [ ] **Step 6: Verify GREEN, Python compilation, and regression**

Run the two focused files, `python -m compileall -q providers/python`, `npm run check`, and `npm test`.
Expected: all pass; on the current machine, the real evaluator probe reports unavailable because no image model is cached.

- [ ] **Step 7: Commit**

```powershell
git add -- providers/python/character_remaster_evaluator.py src/character-remaster/python-evaluator.js src/character-remaster/candidate-batch-runner.js tests/real-mvp/python-evaluator.test.js tests/real-mvp/candidate-batch-runner.test.js
git commit -m "feat: add independent remaster evaluation and batching"
```

---

### Task 5: Complete ComfyUI-first execution and the explicit Diffusers fallback

**Files:**
- Create: `src/providers/comfyui-workflow.js`
- Modify: `src/providers/comfyui-provider.js`
- Modify: `src/providers/diffusers-provider.js`
- Modify: `providers/python/diffusers_worker.py`
- Modify: `tests/generation-providers.test.js`
- Create: `tests/real-mvp/generation-runtime-contracts.test.js`

**Interfaces:**
- `compileComfyWorkflow({ workflow, bindings, request })` returns a deep-cloned ComfyUI API workflow.
- `ComfyUiProvider.generateVariation(request)` uses workflow/bindings supplied to its constructor and returns a standardized completed provider result with artifact path and receipt evidence.
- `DiffusersProvider.generateVariation(request)` uses explicit model configuration supplied to its constructor and sends an image-to-image request to the Python worker.

- [ ] **Step 1: Add failing workflow-compiler and ComfyUI lifecycle tests**

The compiler test binds exact node/input pairs for source image, positive prompt, negative prompt, seed, and filename prefix, while leaving the original workflow byte-for-byte equivalent after serialization.

The HTTP-double test serves:

```text
GET  /system_stats
GET  /object_info
POST /upload/image
POST /prompt
GET  /history/prompt-1
GET  /view?filename=candidate.png&subfolder=eve&type=output
```

Verify upload, queue, bounded history polling, output discovery, binary retrieval, output SHA-256, prompt ID, model identity, seed, and parameter digest.

- [ ] **Step 2: Add failing Diffusers safety tests**

Verify that real generation without an explicit model returns `explicit_model_required`, a remote model with `allowDownload !== true` uses local-files-only and returns `model_not_available_locally`, and fixture mode is labeled `mode: fixture`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/generation-providers.test.js tests/real-mvp/generation-runtime-contracts.test.js`
Expected: FAIL because lifecycle methods and image-to-image requests are absent.

- [ ] **Step 4: Implement the ComfyUI lifecycle**

Use built-in `fetch`, `FormData`, and `Blob`; do not add a ComfyUI dependency. Poll `/history/<promptId>` until the prompt has outputs, a provider error is reported, or the configured deadline expires. A timeout returns an uncertain execution record and does not submit a second prompt.

Select only the configured output node. Reject missing/multiple unexpected outputs with `comfyui_output_ambiguous`.

- [ ] **Step 5: Implement explicit Diffusers image-to-image**

The worker uses `AutoPipelineForImage2Image.from_pretrained` with the explicit model identifier/revision, `local_files_only = not allowDownload`, source image, prompt, negative prompt, strength, guidance scale, inference steps, width/height, and seeded `torch.Generator`.

Return library/model/device/dtype metadata and the generated artifact hash. Do not install Diffusers or download weights in this task.

- [ ] **Step 6: Verify GREEN and regression**

Run both focused files, `npm run check`, and `npm test`.
Expected: all mock/fixture contracts pass; current live provider probe remains unavailable and is not counted as failure.

- [ ] **Step 7: Commit**

```powershell
git add -- src/providers/comfyui-workflow.js src/providers/comfyui-provider.js src/providers/diffusers-provider.js providers/python/diffusers_worker.py tests/generation-providers.test.js tests/real-mvp/generation-runtime-contracts.test.js
git commit -m "feat: complete real generation provider boundaries"
```

---

### Task 6: Add live MRMIC projection and freshness/readback verification

**Files:**
- Modify: `src/mrmic-client.js`
- Modify: `tests/mrmic-client.test.js`
- Create: `tests/real-mvp/mrmic-live.test.js`

**Interfaces:**
- Adds `MrmicClient.getState({ canvasId })`.
- Adds `MrmicClient.submitTransaction({ transaction, bearerToken })`.
- Adds `buildCreatePortalTransaction({ portal, canvasRevision, actor, now, idempotencyKey })`.
- Adds `buildPatchPortalTransaction({ currentPortal, providerResourceId, canvasRevision, actor, now, idempotencyKey })`.
- Adds `MrmicClient.verifyPortal({ canvasId, portalId, providerResourceId })`.

- [ ] **Step 1: Write failing HTTP transaction tests**

Use a local mock MRMIC server to verify:

- capability and state read;
- candidate `create_object` transaction with exact canvas revision;
- stale revision rejection before POST;
- optional bearer token appears only in the Authorization header;
- promoted `patch_object` transaction updates only provider resource identity and projection metadata;
- readback verifies `provider = external`, `resourceKind = artifact`, and `ownershipTransferred = false`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/mrmic-client.test.js`
Expected: FAIL because state/transaction/readback methods are absent.

- [ ] **Step 3: Implement public-contract integration**

Create transactions with this shape:

```js
{
  id,
  canvasId: portal.canvasId,
  actor,
  intent: 'Project EveAtelier candidate artifact',
  expectedOutcome: 'Create one external artifact resource portal',
  preconditions: [{ type: 'canvas_revision', targetId: portal.canvasId, expected: canvasRevision }],
  operations: [{ op: 'create_object', object: portal }],
  mode: 'direct',
  createdAt: now,
  idempotencyKey,
}
```

Validate capability support before mutation. Parse non-2xx JSON errors without exposing Authorization headers. Do not retry POST after timeout or connection uncertainty.

- [ ] **Step 4: Add an opt-in live test**

Skip unless `EVE_REAL_MVP=1` and `EVE_MRMIC_URL` are set. The test reads the live root canvas, creates a uniquely named external artifact portal, verifies readback, patches it to a promoted resource ID using the new revision, and verifies the second readback.

The test prints whether the capability is `legacy_local` or bearer-secured; it does not claim authenticated identity in legacy mode.

- [ ] **Step 5: Verify mock and live MRMIC paths**

Run: `node --test tests/mrmic-client.test.js`
Expected: PASS.

Start the clean sibling server from `D:\Ai\work together\MRMIC_NVCL` with `npm run web`, wait for `/api/capabilities`, then run:

```powershell
$env:EVE_REAL_MVP='1'
$env:EVE_MRMIC_URL='http://127.0.0.1:4173'
node --test tests/real-mvp/mrmic-live.test.js
```

Expected: PASS with candidate and promoted portal readback. Stop the server after evidence capture.

- [ ] **Step 6: Run full regression and commit**

Run `npm run check` and `npm test`, then:

```powershell
git add -- src/mrmic-client.js tests/mrmic-client.test.js tests/real-mvp/mrmic-live.test.js
git commit -m "feat: project remaster candidates into live mrmic"
```

---

### Task 7: Build the resumable real-run CLI, execute available gates, and classify acceptance

**Files:**
- Create: `src/character-remaster/evidence.js`
- Create: `scripts/real-mvp/runtime-probe.mjs`
- Create: `scripts/real-mvp/run-character-remaster.mjs`
- Create: `tests/real-mvp/evidence-classification.test.js`
- Create: `tests/real-mvp/real-run-cli.test.js`
- Create: `docs/mvp/REAL_MVP_CHARACTER_REMASTER_ACCEPTANCE_v0.1.md`
- Modify: `package.json`

**Interfaces:**
- `classifyRealMvpEvidence(evidence)` returns `{ result: 'PASS'|'PARTIAL'|'FAIL', passedGates, blockers }`.
- CLI command `probe --config <path>` writes runtime capability evidence under `artifacts/runtime/real-mvp/`.
- CLI command `generate-evaluate --config <path>` writes candidate receipts, Workbench state, and a human review template, then exits without promotion.
- CLI command `review-promote-project --state <path> --review <path> --config <path>` validates real review, promotes, projects, verifies, and writes final evidence.

- [ ] **Step 1: Write failing evidence-classification tests**

Verify fixture generation, mock MRMIC, automated review, missing semantic evaluator, or one candidate each independently force `PARTIAL`. Verify provider failure with no artifact is `FAIL` for that attempted task but does not erase separately verified gates. Verify only the complete real evidence object returns `PASS`.

- [ ] **Step 2: Write failing CLI safety tests**

Verify that mutating commands reject missing `EVE_REAL_MVP=1`, fixture providers, uncalibrated thresholds, missing review files, candidate-ID mismatch, and absolute private paths in sanitized output.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/real-mvp/evidence-classification.test.js tests/real-mvp/real-run-cli.test.js`
Expected: FAIL because evidence and CLI modules are absent.

- [ ] **Step 4: Implement evidence classification and two-stage execution**

Sanitized evidence includes logical task/candidate IDs, SHA-256 hashes, provider/model/evaluator identities and versions, score summaries, review disposition, promotion result, MRMIC mode/result, test counts, and blockers. It excludes image bytes, source/reference absolute paths, environment secrets, Authorization headers, and model cache paths.

Add package scripts:

```json
"real-mvp:probe": "node scripts/real-mvp/runtime-probe.mjs probe",
"real-mvp:run": "node scripts/real-mvp/run-character-remaster.mjs"
```

- [ ] **Step 5: Verify GREEN and commit the executable flow**

Run focused tests, `npm run check`, and `npm test`. Then commit:

```powershell
git add -- package.json src/character-remaster/evidence.js scripts/real-mvp tests/real-mvp/evidence-classification.test.js tests/real-mvp/real-run-cli.test.js
git commit -m "feat: add resumable real mvp execution and evidence"
```

- [ ] **Step 6: Run the current environment probe**

Record exact ComfyUI, Diffusers, evaluator, GPU, and MRMIC results. Do not install or download anything during the probe.

- [ ] **Step 7: Cross the remaining authority gates**

Before any model download, present the exact generation/evaluator model IDs, sources, licenses, estimated download sizes, and expected RTX 3070 memory modes to the user and obtain approval.

Before the real run, obtain a rights-clear local source/reference pack from the user. Keep image bytes in the ignored fixture directories.

After candidate generation/evaluation, present candidate evidence and preview paths to the user. The user writes or authorizes the human review record; automated code does not invent it.

- [ ] **Step 8: Execute real generation, evaluation, review, promotion, and MRMIC projection**

Run the generate/evaluate stage, inspect all artifacts, collect the real review, then run review/promote/project. Preserve any provider uncertainty without resubmission.

- [ ] **Step 9: Write the acceptance report**

The report has separate sections:

```text
Verified real evidence
Automated contract evidence
Live local integration evidence
Blockers and unmeasured gates
Result: PASS | PARTIAL | FAIL
```

If real assets, models, evaluator, review, or live MRMIC remain unavailable, write `PARTIAL` with exact blockers and the next narrow gate.

- [ ] **Step 10: Perform final verification and commit the report**

Run fresh:

```powershell
npm run check
npm test
git diff --check
git status --short --branch
```

Record exact counts and commit only tracked implementation/report files:

```powershell
git add -- docs/mvp/REAL_MVP_CHARACTER_REMASTER_ACCEPTANCE_v0.1.md
git commit -m "docs: report real mvp character remaster acceptance"
```

- [ ] **Step 11: Produce a preservation-safe handoff archive**

Create a ZIP from the exact branch tree plus a manifest and verification summary. Exclude `.git`, dependency caches, runtime/private images, bearer tokens, and unrelated pre-existing archives. Verify archive paths, member hashes, and extraction into a temporary directory before reporting it.
