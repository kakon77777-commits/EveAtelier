# EveAtelier Real MVP Phase 1 Character Remaster Design

Date: 2026-08-30
Status: user-approved handoff reconciliation
Branch: `integration/real-mvp-character-remaster`

## Authority and provenance

The user explicitly authorized taking over the Real MVP work from the supplied handoff package and using a dedicated local EveAtelier checkout as the working directory.

The supplied package is:

- `EveAtelier_Real_MVP_Phase1_Handoff_v0.1_2026-08-30.zip`
- package SHA-256: `e6b187b642a218698c93f15eba2cfad75fb08cc82c466419c7e55b7d389cc5e3`
- canonical repository: `kakon77777-commits/EveAtelier`
- verified remote baseline: `main@2aad5e79d8442197a15c8cd5c0d95b4149e878a1`
- verified baseline tree: `fbeda5de0efd0b52b51aa029db607781c5035c4d`

The two Markdown files inside the package are the adopted product design and execution brief. They are not treated as evidence that any runtime or acceptance gate has passed. Current local observations override stale environment statements in the handoff.

## Current verified state

- The canonical checkout was restored without replacing the pre-existing backup or research archives.
- Baseline regression is `20/20 PASS` on Node.js `v24.16.0` and Python `3.14.5`.
- `npm run check` is not cross-platform: it invokes Unix `find -print0` and `xargs` through Windows `cmd.exe`; `xargs` is absent. This is a validation-entrypoint defect, not a source syntax failure.
- The machine has an NVIDIA GeForce RTX 3070 with 8 GiB VRAM.
- Python has `torch`, `transformers`, Pillow, NumPy, and safetensors, but not `diffusers`, torchvision, OpenCLIP, OpenCV, or a cached image-embedding model.
- No local image-generation checkpoint was found under the scoped model locations.
- ComfyUI is not listening at `127.0.0.1:8188`.
- MRMIC is not currently listening at `127.0.0.1:4173`, but the clean local `MRMIC_NVCL` checkout is at Phase 13 v0.14.0 and exposes `/api/capabilities`, `/api/state`, and `/api/transaction`.

These observations mean that code and cross-process MRMIC integration can proceed immediately. Real generation, semantic evaluation, and real human review remain gated on explicit model/runtime and asset inputs.

## Goal

Implement one source-preserving Character Remaster path:

```text
real source and typed references
  -> provider-neutral generation request
  -> ComfyUI-first or explicitly configured Diffusers execution
  -> 2-4 staged candidates
  -> deterministic and semantic evaluation
  -> recorded human review
  -> controlled Workbench promotion
  -> live MRMIC candidate and promoted projection
  -> evidence-classified acceptance report
```

The implementation must make all unavailable or unmeasured real-world gates fail closed. A successful fixture, mock HTTP server, provider receipt, or automated review record must never be reported as Real MVP PASS.

## Non-goals

- No editor UI, brush engine, batch-character pipeline, animation, video, 3D, cloud collaboration, marketplace, full OFP, or deep GIMP/Krita integration.
- No copying ComfyUI code into EveAtelier core.
- No automatic model download, model installation, or private asset publication.
- No direct mutation of MRMIC `CanvasStore` internals.
- No new operator ontology or second Workbench version system.

## Chosen approach

### Primary: ComfyUI external provider

Extend the existing HTTP adapter with source upload, provider-owned workflow compilation, queue tracking, history polling, output discovery, and artifact retrieval. Workflow node IDs and sampler/checkpoint parameters remain in a caller-supplied provider configuration. The canonical operator remains `visual.op.generative.generate_variation`.

This is preferred because it preserves the GPL application boundary and supports environment-specific image-to-image graphs without teaching Workbench ComfyUI semantics.

### Secondary: explicit Diffusers fallback

Extend the existing subprocess provider to accept a source image and an explicitly named image-to-image model. Local-files-only is the default. Network download requires a separate explicit flag after model identity, source, license, storage, and VRAM have been reviewed.

### Rejected as acceptance evidence: fixture generation

Fixture generation remains available for deterministic contract regression only. Its receipt carries `mode: fixture`, and the acceptance classifier excludes it from real-provider evidence.

## Component design

### 1. Cross-platform validation entrypoint

A Node script discovers JavaScript source files and invokes `node --check` without shell-specific utilities, then compiles the Python provider tree using an available configured interpreter. This restores one runnable `npm run check` command on Windows and Unix-like hosts.

### 2. Typed Character Remaster intent and references

The Character Remaster contract validates:

- one existing source asset;
- `candidateCount` from 2 through 4;
- required roles `line_reference`, `color_reference`, and `negative_reference`;
- optional `quality_reference` and `identity_reference`;
- source/reference SHA-256 identities;
- provider-neutral intent and constraints.

The request builder emits a provider-neutral `generate_variation` request. Provider-specific workflow bindings never enter Workbench state.

### 3. Candidate batch and evidence

The batch runner requests 2-4 candidates with distinct seeds or provider execution IDs. Each result records provider identity/version, model identity, source hash, output hash, parameter digest, receipt, and lineage before it is staged as `candidate` with verdict `UNVERIFIED`.

Generation completion does not update `currentVersionId`.

### 4. Evaluation stack

Evaluation has four separately reported layers:

1. deterministic artifact validation: existence, decode, dimensions, format, non-empty pixels, alpha, and SHA-256;
2. identity measurement: a versioned image-embedding or equivalent evaluator comparing source and candidate;
3. reference measurement: role-specific line, color, positive-style, and negative-reference scores;
4. human review: an explicit review record that may approve, reject, or accept with warnings.

Embedding similarity is described as representation similarity, not exact identity proof. Threshold configuration must name its calibration status and fixture set. An example or uncalibrated threshold file can only produce `UNVERIFIED`.

The automated verdict set is `ACCEPT`, `ACCEPT_WITH_WARNINGS`, `REPAIR`, `REJECT`, or `UNVERIFIED`. Missing evaluator runtime, missing scores, uncalibrated thresholds, or deterministic failure cannot produce `ACCEPT`.

### 5. Workbench review, persistence, and promotion

The existing `EveAtelierWorkbench` remains authoritative for document and version state. It gains:

- a validated human-review record on a candidate;
- JSON-safe state export/import so generation and human review may occur in separate local invocations;
- a stricter human-required promotion gate.

For `human_required`, promotion requires both an acceptable independent evaluation and a review record with an approving disposition. An `approvedBy` string alone is no longer sufficient for the Real MVP path. Source bytes and the source version hash must remain unchanged.

### 6. Live MRMIC projection

`MrmicClient` gains state read, transaction submission, and readback verification over public HTTP contracts. It builds a `create_object` or `patch_object` transaction using the current canvas revision and fails with `STALE_INPUT` when the expected revision is stale.

The portal remains:

```text
provider = external
resourceKind = artifact
ownershipTransferred = false
portalSchema = native_resource_portal_v1
```

Candidate projection and promoted projection are verified by reading `/api/state`. Legacy-local MRMIC can prove local cross-process integration, but it is reported as unauthenticated local compatibility rather than verified PMW identity.

### 7. Two-stage real-run CLI

The opt-in runner requires `EVE_REAL_MVP=1` and has two explicit stages:

1. generate/evaluate: persist sanitized receipts, Workbench state, and a review template, then stop;
2. review/promote/project: consume a user-authored review record, promote only if all gates pass, project to MRMIC, and verify readback.

Private images, local absolute paths, bearer tokens, and model caches stay in gitignored runtime evidence. A sanitized report may include hashes, relative logical identifiers, versions, score summaries, and evidence classification.

## Error and evidence policy

- External service absence is `unavailable`, not test failure and not PASS.
- Timeout is bounded and recorded; there is no blind retry of an uncertain provider execution.
- A queued prompt without retrieved artifact is not completed generation.
- A provider receipt is never an evaluation.
- Automated fixture approval is labeled `automated_contract_evidence` and cannot satisfy real human review.
- Model and evaluator licenses are independent from adapter/library licenses.
- Private source and reference bytes are never added to Git by default.
- Any incomplete real gate yields `PARTIAL` with the exact blocker and retained verified positives.

## Verification and acceptance

Normal regression must remain external-service-free. Unit tests use local fixtures and mock HTTP servers. Live tests require explicit environment flags.

Real MVP Phase 1 is `PASS` only when all of the following are measured in one traceable run:

1. a real provider generated at least two candidates from a real source/reference pack;
2. a versioned real evaluator produced identity and reference evidence;
3. calibrated thresholds yielded an acceptable candidate;
4. a real user review approved the selected candidate;
5. Workbench promotion changed the current version while preserving source bytes;
6. a live MRMIC process showed candidate and promoted projections with successful freshness/readback checks;
7. the full offline regression and cross-platform check passed;
8. the acceptance report distinguishes real, automated, and unmeasured evidence.

If model/runtime or human inputs are still absent after all independent engineering work is complete, the correct result is `PARTIAL`, not a lowered PASS definition.
