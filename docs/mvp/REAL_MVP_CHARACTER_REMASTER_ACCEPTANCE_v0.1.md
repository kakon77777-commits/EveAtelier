# EveAtelier Real MVP Phase 1 Character Remaster Acceptance v0.1

Date: 2026-08-30

Branch: `integration/real-mvp-character-remaster`

Canonical baseline: `main@2aad5e79d8442197a15c8cd5c0d95b4149e878a1`

## Result

**PARTIAL**

The Real MVP architecture and executable boundaries are implemented and independently regressed. The approved external generation runtime, generation model, and evaluator model are installed. A complete five-image private local asset pack is present, multiple negative-reference binding is implemented, private-fixture thresholds were frozen before generation, and two real candidates were generated and independently evaluated as `ACCEPT`. The game-source asset is not proven `rights_clear_real`; human review, promotion, and candidate-specific MRMIC projection have not occurred.

The PASS definition has not been lowered.

## Handoff integrity

Supplied package:

`EveAtelier_Real_MVP_Phase1_Handoff_v0.1_2026-08-30.zip`

- package SHA-256: `e6b187b642a218698c93f15eba2cfad75fb08cc82c466419c7e55b7d389cc5e3`
- internal manifest entries: 2
- entry hash matches: 2/2
- entry hash failures: 0

The package documents were used as the user-approved design/execution brief, not as evidence that any acceptance gate had already passed.

## Implemented engineering

### Cross-platform verification

- Replaced the Unix-only `find | xargs` validation command with a shell-independent Node checker.
- `npm run check` now validates JavaScript syntax and Python compilation on Windows.
- The original failure was classified as a validation harness/platform defect, not a product syntax failure.

### Typed source/reference intent

- Requires `line_reference`, `color_reference`, and `negative_reference`.
- Supports optional `quality_reference` and `identity_reference`.
- Restricts batches to 2-4 candidates.
- Records source/reference SHA-256 and byte counts.
- Emits provider-neutral `visual.op.generative.generate_variation` requests.
- Keeps local source/reference image directories ignored by Git.

### Independent evaluation and human review

- Added fail-closed verdict logic for deterministic artifact validity, identity, line, color, style, artifact quality, and negative-reference evidence.
- Unidentified evaluators and uncalibrated thresholds return `UNVERIFIED`.
- Added an optional Python hybrid evaluator using a versioned image-embedding model plus deterministic line/color measurements.
- Embedding similarity is explicitly representation similarity, not exact identity proof.
- Added structured human review validation.
- `human_required` promotion now requires a stored approving review; an `approvedBy` string alone is insufficient.
- Added hash-verified Workbench state export/import for the generation-to-review pause.

### Real provider boundaries

- ComfyUI adapter now supports source upload, provider-owned workflow compilation, queue submission, bounded history polling, configured output-node selection, binary retrieval, model identity, parameter digest, and uncertain-after-dispatch timeout classification.
- Diffusers fallback now requires an explicit model, defaults to local-files-only, supports image-to-image generation, and records library/model/device evidence.
- Fixture generation remains available only for contract regression and is always labeled `mode: fixture`.

### Candidate batch and resumable execution

- Added 2-4 candidate batching with distinct seeds, standardized receipts, independent evaluation, source hash preservation, and no automatic promotion.
- Added opt-in `generate-evaluate` and `review-promote-project` commands.
- Added evidence sanitization that removes tokens, binary payloads, and absolute local paths from shareable records.
- Added a machine-enforced Real MVP evidence classifier.

### MRMIC live integration

- Corrected pre-MVP portal schema drift:
  - `bindings` is now an array;
  - transform includes width, height, and z-index;
  - interaction mode is `read_only`, a valid Phase 13 value.
- Added capability negotiation, state read, transaction submission, candidate projection, promoted projection, freshness guard, and readback verification.
- POST uncertainty is not retried.

## Verified live local integration evidence

MRMIC sibling checkout:

- repository: `<local-mrmic-checkout>`
- version: `0.14.0`
- commit: `791efb9`
- tracked state before and after: clean, equal to `origin/main`
- TypeScript check: PASS
- MRMIC automated tests: 175/175 PASS

EveAtelier opt-in live test:

- result: 1/1 PASS
- capability schema: `mrmic-capabilities/v1`
- portal schema: `native_resource_portal_v1`
- workspace: `workspace-demo`
- canvas: `canvas-root`
- canvas revision: 0 -> 2
- portal ID: `portal:eve-atelier:0a299893-a59a-423f-9ceb-03b8bfe7007d`
- portal revision: 1
- final provider resource ID: `artasset://eve-atelier/0a299893-a59a-423f-9ceb-03b8bfe7007d/promoted`
- provider: `external`
- resource kind: `artifact`
- ownership transferred: false
- portal ID present in live SVG render: true
- promoted provider resource ID present in live SVG render: true
- identity mode: `legacy_local`; this is live local integration, not verified bearer identity

The MRMIC server was stopped after the test. Port 4173 was no longer listening, and the sibling checkout remained clean.

This live projection used generated logical artifact identifiers to verify the cross-process bridge. It is not evidence of a real remastered candidate.

## Automated contract evidence

Fresh EveAtelier verification after implementation:

- `npm run check`: PASS
- JavaScript files checked: 20
- Python provider compilation: PASS
- Node tests discovered: 55
- tests passed: 54
- tests failed: 0
- tests skipped: 1
- skipped test: explicit opt-in live MRMIC test during ordinary offline regression
- separate opt-in live MRMIC run: 1/1 PASS

The suite covers:

- original pre-MVP scenarios;
- cross-platform validation;
- typed references and byte identities;
- evaluation threshold ordering;
- human review and promotion gates;
- Workbench persistence and artifact-drift rejection;
- candidate batching and source preservation;
- ComfyUI upload/queue/history/retrieval;
- tracked vanilla SD1.5 image-to-image workflow compilation;
- Diffusers explicit-model/local-only behavior;
- tensor and pooled image-feature output normalization;
- evidence classification and sanitization;
- MRMIC create/patch/readback and stale-pre-dispatch rejection.

Automated fixtures, HTTP doubles, and simulated review records are contract evidence only.

## Runtime readiness and real provider/evaluator smoke

External runtime root: `<local-external-runtime>`

Runtime manifest: `<local-external-runtime>/manifests/RUNTIME_MANIFEST.json`

Machine-local run config: `<local-external-runtime>/configs/real-mvp-comfyui.json`

Observed:

- Node.js: `v24.16.0`
- platform: `win32`
- GPU: NVIDIA GeForce RTX 3070
- VRAM: 8192 MiB
- NVIDIA driver: `610.62`
- external runtime disk use: 10.91 GiB
- ComfyUI: `0.34.0`
- ComfyUI Python: `3.13.14`
- ComfyUI Torch: `2.13.0+cu130`
- ComfyUI CUDA: `13.0`
- ComfyUI device: `cuda:0 NVIDIA GeForce RTX 3070`
- ComfyUI custom nodes: disabled
- ComfyUI binding: localhost `127.0.0.1:8188`
- ComfyUI queue after smoke: running 0, pending 0
- generation checkpoint: SD1.5 EMA-only, 4,265,146,304 bytes, SHA-256 verified
- evaluator: SigLIP B/16 pinned at `7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed`
- evaluator model and six processor/tokenizer files: 7/7 hashes verified
- evaluator execution: CPU through isolated `.venv`
- evaluator SentencePiece: `0.2.2`, wheel SHA-256 verified
- global Python environment modified: false

Real provider smoke:

- evidence class: `REAL_PROVIDER_FIXTURE_SOURCE`
- ComfyUI prompt execution: completed
- execution ID: `c38ff4cf-336b-409d-9bd7-d0a7051101b5`
- model: `stable-diffusion-v1-5/stable-diffusion-v1-5`
- model revision: `451f4fe16113bff5a5d2269ed5ad43b0592e9a14`
- parameter digest: `cabf71be40b6774475d42a05008eb3de83144937b6cbe17e964ce19e4dd60843`
- output PNG: 127,618 bytes
- output SHA-256: `1db202a9b12ce47e6e776f3219d4c09623f660984807e19aa7214730563de254`
- source class: deterministic test fixture, not a rights-clear user Character Remaster task
- real provider execution time: approximately 51 seconds including first model initialization

Real evaluator smoke:

- evidence class: `REAL_EVALUATOR_FIXTURE_SOURCE_UNCALIBRATED`
- evaluator: `evaluator:clip-hybrid` v0.1.0
- model license: Apache-2.0
- measurement: representation similarity, not exact identity proof
- artifact decode/dimensions/hash: verified
- scores: identity 0.9023, line 1.0000, color 0.8459, style 0.9023, artifact quality 1.0000, negative similarity 0.6259
- verdict: `UNVERIFIED`
- exact reason: `thresholds_not_calibrated`

The smoke evidence proves that the real provider and evaluator paths execute. It does not satisfy the real source/reference, calibrated evaluation, or human-review gates.

ComfyUI was stopped after smoke verification. Port 8188 and the ComfyUI process count returned to zero; the verified runtime remains restartable.

The system Python remains CPU-only. CUDA generation is provided only by the isolated ComfyUI portable runtime.

## Private asset intake evidence

Asset-pack metadata: `artifacts/runtime/real-mvp/asset-intake/asset-pack-v1.json` (gitignored)

Negative-reference metadata: `artifacts/runtime/real-mvp/asset-intake/negative-references.json` (gitignored)

Observed and independently rechecked:

- source target: `fixtures/real_mvp/character_remaster/source/character_1001.png`
- source SHA-256: `41dc532e38374e3f5c2215f9c9789a1f2af3c9c772df0a6ac842383d4401f248`
- source shape: 1280x1280 RGBA
- source classification: BuildID 25006280 game-original offline research copy, `resources.assets` pathID 2637, research identity `萬輕舟1`
- line target: `fixtures/real_mvp/character_remaster/reference/line_ref.png`
- line SHA-256: `4eae1389d9d5dd8ae416610757a357ec39bb9c60280cde1e12611ed0fdadef4a`
- line shape: 1254x1254 RGB
- line classification: user-provided generated private reference; baked black background must not be inherited
- color target: `fixtures/real_mvp/character_remaster/reference/color_ref.png`
- color SHA-256: `7b94abbb23612e7eddf4426041875e530f877a4c0d162cd8ed98d766effd57c4`
- color shape: 1122x1402 RGB
- color classification: user-provided generated private reference; generated calligraphy and seals are not reliable content to inherit
- negative references: two user-provided private images, both marked `negative_reference`, with no primary or ordering
- source/line/color origin-to-target hashes: 3/3 exact
- all five private images matched Git ignore rules and remained absent from `git status`
- workshop "cool clothing" images were excluded from selection
- mutations to the game original: 0

Authority classification:

- private local EveAtelier experiment: user-authorized
- public redistribution or Git submission: not authorized
- `rights_clear_real`: not proven

Private approval permits a bounded local experiment but does not satisfy or replace the stricter public-rights evidence gate.

## Private Basic MVP generation and evaluation

Experiment ID: `character-remaster-private-001`

Execution class: `private_research_authorized`

Frozen calibration:

- scope: `PRIVATE_FIXTURE_ONLY`
- asset-pack manifest SHA-256: `66408d3343a53f52cdb3e8f786d66d5ab18f8c853f37ba058d3f92f814ff03de`
- identity minimum: 0.855285
- maximum negative-reference similarity: 0.855285
- thresholds frozen before candidate generation: true
- line metric caveat: measured controls were non-discriminative
- human review required: true

Candidate 01:

- version: `document:wan-qingzhou-private-001:v1`
- seed: 41001
- SHA-256: `166d906ec08b00921f64e1c835ea60a77ae32c308ba3b79feed705db3ed02d64`
- automated verdict: `ACCEPT`
- identity: 0.9773
- line: 0.9942
- color: 0.2979
- style: 0.7728
- artifact quality: 1.0000
- maximum negative similarity: 0.7022

Candidate 02:

- version: `document:wan-qingzhou-private-001:v2`
- seed: 41002
- SHA-256: `3ddd032adf3735f9c1d9fa2f4029b2ed7da823930baea5561a130b8046a359ab`
- automated verdict: `ACCEPT`
- identity: 0.9734
- line: 0.9936
- color: 0.2922
- style: 0.7623
- artifact quality: 1.0000
- maximum negative similarity: 0.6818

Workbench state:

- current version remains `document:wan-qingzhou-private-001:v0`
- source hash preserved: true
- candidate count: 2
- promotion performed: false

Private review package:

- desktop path: `<user-desktop>/EveAtelier_Private_Basic_MVP_Review_2026-08-31.zip`
- bytes: 13,697,478
- SHA-256: `4b6f4c877db312eb4def9c39e4b92ae1267e561272b93bb1190f9f8f2ce21719`
- archive files: 15
- manifest entries: 14
- manifest hash matches: 14/14
- unsafe paths: 0
- package scope: `PRIVATE_REVIEW_ONLY`

The web GPT review is advisory only and cannot become the formal `human_observed` review automatically.

## Acceptance gates

| Gate | Status | Evidence |
|---|---|---|
| P1: real source/reference -> at least two real candidates | TECHNICAL PASS / RIGHTS BLOCKED | Five-image private pack, multiple negative binding, and two real ComfyUI candidates verified; game source is not proven `rights_clear_real` |
| P2: real evaluator evidence | PRIVATE-FIXTURE PASS | Frozen private-fixture thresholds and real SigLIP evaluation produced two `ACCEPT` verdicts; no cross-pack generalization claimed |
| P3: accepted candidate passes promotion gate | EVALUATION PASS / HUMAN GATE PENDING | Two accepted candidates exist; neither can promote before user review |
| P4: current version changes after real human review | BLOCKED | No real human review; no promotion |
| P5: live MRMIC candidate/promoted projection | CONTRACT + PRIOR LIVE BRIDGE PASS, CURRENT CANDIDATES PENDING | Cross-process bridge was previously verified; current candidates wait for review/promotion |
| P6: evidence and acceptance report | PASS FOR CURRENT PARTIAL STATE | This report, runtime probe, test output, and commit history |

## Exact blockers

1. The game-source research copy is privately authorized for this local experiment but is not proven `rights_clear_real`.
2. No real user review has been recorded.
3. No candidate has been promoted.
4. The current candidates have not been projected through MRMIC.

## Installed approved runtime

### External generation runtime

- ComfyUI official Windows NVIDIA portable `v0.34.0`
- archive: `ComfyUI_windows_portable_nvidia.7z`
- observed compressed size: approximately 2.00 GiB
- archive SHA-256: `ed57cc6b19ae3d83add1ecebfdd56b25e04e0008cf0fe9af43a4ad8797e2a24c`
- license: GPL-3.0, retained as an independently running external provider

### Generation checkpoint

- model repository: `stable-diffusion-v1-5/stable-diffusion-v1-5`
- file: `v1-5-pruned-emaonly.safetensors`
- size: 4.27 GB
- SHA-256: `6ce0161689b3853acaa03779ec93eafe75a02f4ced659bee03f50797806fa2fa`
- license: CreativeML OpenRAIL-M
- intended first run: vanilla 512x512 image-to-image workflow with no custom nodes

### Evaluator model

- model: `google/siglip-base-patch16-224`
- file: `model.safetensors`
- size: 813 MB
- SHA-256: `2c63cb7d1f2e95ba501893cbb8faeb4ea9a3af295498d35097126228659c2af8`
- license: Apache-2.0
- execution: CPU is sufficient for the small candidate batch; GPU is not claimed

Measured external runtime storage after installation: 10.91 GiB.

## Next narrow gate: human review

1. User discusses the desktop `PRIVATE_REVIEW_ONLY` ZIP with the web GPT.
2. User selects candidate v1, candidate v2, or neither and supplies `APPROVE`, `ACCEPT_WITH_WARNINGS`, or `REJECT` plus a reason.
3. EveAtelier records the user decision as the only formal `human_observed` review.
4. If approved, promote the selected candidate while verifying the source hash remains unchanged.
5. Start MRMIC, project candidate and promoted state, verify readback/render, and stop MRMIC normally.
6. Rerun full verification and update this report to the final private Basic MVP classification.

## Non-claims

- No Real MVP PASS is claimed.
- The earlier single-image provider smoke remains fixture-source evidence only.
- One two-candidate private-pack generation/evaluation run is claimed with two automated `ACCEPT` verdicts.
- No rights-clear user Character Remaster generation batch is claimed.
- No identity preservation is claimed from provider receipts or fixtures.
- No human approval is claimed.
- Approved runtimes and model weights were installed only under the adjacent external runtime; no model bytes entered Git.
- No private image was committed.
- No remote branch, release, deployment, or publication occurred.
