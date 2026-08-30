# EveAtelier Real MVP Phase 1 Character Remaster Acceptance v0.1

Date: 2026-08-30

Branch: `integration/real-mvp-character-remaster`

Canonical baseline: `main@2aad5e79d8442197a15c8cd5c0d95b4149e878a1`

## Result

**PARTIAL**

The Real MVP architecture and executable boundaries are implemented and independently regressed. A real Character Remaster task has not yet run because no rights-clear source/reference pack or approved generation/evaluator model runtime is present. No human review or real candidate promotion has occurred.

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

- repository: `D:\Ai\work together\MRMIC_NVCL`
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
- Node tests discovered: 50
- tests passed: 49
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
- Diffusers explicit-model/local-only behavior;
- evidence classification and sanitization;
- MRMIC create/patch/readback and stale-pre-dispatch rejection.

Automated fixtures, HTTP doubles, and simulated review records are contract evidence only.

## Runtime readiness probe

Evidence file: `artifacts/runtime/real-mvp/runtime-probe.json` (gitignored)

Observed:

- Node.js: `v24.16.0`
- platform: `win32`
- GPU: NVIDIA GeForce RTX 3070
- VRAM: 8192 MiB
- NVIDIA driver: `610.62`
- free storage on D: approximately 254.9 GiB
- ComfyUI `127.0.0.1:8188`: unavailable
- Diffusers: not installed
- system Python Torch: `2.12.0+cpu`
- system Python CUDA availability: false
- image evaluator model: not configured/cached
- MRMIC during post-test probe: unavailable because the verified server had been stopped

The presence of an NVIDIA GPU does not make the current Python runtime CUDA-capable.

## Acceptance gates

| Gate | Status | Evidence |
|---|---|---|
| P1: real source/reference -> at least two real candidates | BLOCKED | No rights-clear local source/reference pack; no real generation runtime/model |
| P2: real evaluator evidence | BLOCKED | Evaluator boundary exists; no approved/cached image model or calibrated fixture thresholds |
| P3: accepted candidate passes promotion gate | BLOCKED | No real candidates/evaluation |
| P4: current version changes after real human review | BLOCKED | No real human review; no promotion |
| P5: live MRMIC candidate/promoted projection | CONTRACT + LIVE BRIDGE PASS, REAL ASSET NOT MEASURED | Cross-process create/patch/render passed with logical artifact IDs |
| P6: evidence and acceptance report | PASS FOR CURRENT PARTIAL STATE | This report, runtime probe, test output, and commit history |

## Exact blockers

1. A rights-clear local source image is absent.
2. Required line, color, and negative references are absent.
3. ComfyUI is not installed or running.
4. No approved generation checkpoint is present.
5. Diffusers is absent and the current Torch installation is CPU-only.
6. No approved image-embedding model is cached.
7. Thresholds remain `EXAMPLE_UNCALIBRATED` because no real fixture set has been measured.
8. No real candidate batch has been generated.
9. No real user review has been recorded.
10. No real Workbench candidate has been promoted.

## Recommended next narrow gate, pending user approval

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

Estimated additional local storage, including extracted runtime and caches: 10-15 GiB. This is an estimate; exact post-extraction size will be measured if approved.

After approval, the next sequence is:

1. download and hash-verify the three approved artifacts;
2. start and probe ComfyUI without custom nodes;
3. place the user-approved private source/reference pack in ignored directories;
4. calibrate thresholds on that declared fixture set;
5. generate two candidates and stop for real human review;
6. consume the review, promote the selected candidate, start MRMIC, project candidate/promoted state, and verify render;
7. rerun full verification and update this report to the measured final classification.

## Non-claims

- No Real MVP PASS is claimed.
- No real image-generation provider execution is claimed.
- No identity preservation is claimed from provider receipts or fixtures.
- No human approval is claimed.
- No model was downloaded or installed in this work.
- No private image was committed.
- No remote branch, release, deployment, or publication occurred.
