# EveAtelier Pre-MVP / Basic MVP Acceptance Report v0.1

Date: 2026-08-30
Branch: `integration/pre-mvp-oss-spikes`

## Result

Two separate conclusions are required:

- **Architecture / Workbench acceptance: PASS**
- **Real generative visual MVP: PARTIAL**

The distinction is intentional. A completed Provider receipt is not visual acceptance, and a fixture-generated image is not evidence that a real image model preserves character identity.

## What was executed

### 1. OSS Inventory — PASS

Created:

- `docs/oss/OSS_INVENTORY_v0.1.md`
- `docs/oss/EXTRACTION_MATRIX_v0.1.md`
- `docs/oss/LICENSE_BOUNDARY_AUDIT_v0.1.md`

The default permissive / isolated strategy is:

- miniPaint: selective adaptation/reference, MIT.
- sharp/libvips: target deterministic raster library path; unavailable in this execution container.
- OpenRaster 0.0.6: clean minimal codec implementation from the format specification.
- LittleCMS core: future MIT color-management library candidate; FastFloat plugin excluded from the permissive default path.
- libmypaint: future brush-provider candidate.
- GEGL: external/reference-first until a per-operation license allowlist exists.
- GIMP/Krita: external-provider/reference-first for the MVP boundary.
- ComfyUI: isolated external HTTP Generation Provider.
- Diffusers: native Python Generation Provider candidate when dependencies/model are explicitly available.

## 2. Extraction Matrix — PASS

Every upstream candidate is classified as one or more of:

`COPY_ADAPT`, `LIBRARY`, `EXTERNAL_PROVIDER`, `REFERENCE_ONLY`, `REIMPLEMENT`.

No GPL application is copied into EveAtelier core in the current spike.

## 3. License Boundary Audit — PASS

Important enforced boundaries:

- Open source does not imply code can be mixed without review.
- GEGL library licensing and individual operation licensing are treated separately.
- GIMP/Krita/ComfyUI stay isolated from EveAtelier core unless a future distribution/license decision explicitly changes that boundary.
- Model weights are audited independently from Diffusers library licensing.

## 4. Deterministic Core Spike — PASS with backend substitution

Target production path: sharp/libvips.

Execution-container path: `PillowRasterProvider`, clearly labeled as a reference provider because npm/package resolution was unavailable.

Operators exercised:

- crop
- resize
- create mask
- create alpha
- edge cleanup
- recolor
- layer composite

OpenRaster 0.0.6 minimal round-trip is also covered.

This validates the provider-neutral Operator boundary, not sharp/libvips performance.

## 5. Generation Spike — CONTRACT PASS / REAL MODEL PARTIAL

### ComfyUI

- External HTTP adapter implemented.
- `/system_stats` probe and `/prompt` request mapping tested against a local mock server.
- No ComfyUI source code is imported into EveAtelier core.
- No real ComfyUI server was available in this execution environment.

### Diffusers

- Python subprocess boundary implemented.
- Real probe fails honestly with `diffusers_not_installed` in this execution environment.
- Fixture runtime produces deterministic PNG artifacts for contract/workbench testing.
- Fixture generation is not counted as real generative visual evidence.

## 6. OFP-lite Spike — PASS as an explicit approximation

Implemented:

- approximate normal inference from luminance gradients;
- deterministic directional relighting with warm fill;
- exact alpha preservation test;
- dimension preservation test.

This is an MVP approximation and is not a claim that the full historical OFP proposal has been implemented or validated.

## 7. MRMIC Bridge — PASS at contract level

Implemented against the published MRMIC Phase 13 contracts:

- `/api/capabilities` parsing for `mrmic-capabilities/v1`;
- fail-closed malformed capability rejection;
- `native_resource_portal_v1` art-resource projection;
- `provider=external`, `resourceKind=artifact` compatibility binding;
- explicit `ownershipTransferred=false`;
- expected-revision freshness guard returning `STALE_INPUT`.

The bridge does not mutate `CanvasStore` directly and does not transfer external asset authority into MRMIC.

No live MRMIC process E2E was run in this container.

## 8. Acceptance Scenarios

### A. Background Removal — PASS

Pipeline:

`CREATE_MASK -> CREATE_ALPHA -> EDGE_CLEANUP -> independent alpha validation -> candidate -> promotion`

Evidence:

- source asset hash remains unchanged;
- output contains both transparent and opaque pixels;
- promotion occurs only after independent validation.

Provider evidence: real local Pillow/OpenCV/NumPy reference runtime.

### B. Identity-Preserving Relight — PASS within OFP-lite scope

Pipeline:

`INFER_NORMAL -> RELIGHT -> independent dimension/alpha/RGB validation -> candidate -> promotion`

Evidence:

- dimensions unchanged;
- alpha hash unchanged;
- RGB hash changed;
- promotion occurs after validation.

Provider evidence: real local OFP-lite approximation.

This proves structural/alpha preservation, not semantic human identity recognition.

### C. Character Remaster — PARTIAL by design

Pipeline:

`fixture GENERATE -> candidate staging -> UNVERIFIED evaluation -> no promotion`

Evidence:

- fixture produces a real artifact file;
- Workbench stages a new candidate version;
- current document version remains unchanged;
- even explicit promotion is rejected because the candidate verdict is `UNVERIFIED`.

Missing evidence:

- real Diffusers or ComfyUI image generation;
- real identity comparison/evaluator;
- real style/reference comparison.

This is the expected fail-closed behavior.

## Verification Snapshot

Fresh full suite before this report:

- **20 tests**
- **20 pass**
- **0 fail**
- **0 skipped**

Provider probe snapshot is stored at:

`artifacts/pre-mvp/provider-probe.json`

Observed provider availability:

- Pillow reference provider: available, 12.3.0
- sharp: unavailable (`sharp_not_installed`)
- Diffusers: unavailable (`diffusers_not_installed`)
- ComfyUI: unavailable (`comfyui_unavailable`)
- OFP-lite: available as local approximation

## Architecture Invariants Demonstrated

The spike now demonstrates executable evidence for:

`Operator != Provider != Provider Parameter Set`

`Provider receipt != visual acceptance`

`Execution != canonical promotion`

`Source mutation is source-preserving by default`

`MRMIC projection != provider resource ownership`

`Stale revision => fail closed`

## Next Real-MVP Gate

The next gate is deliberately narrow:

1. Run one real Generation Provider: ComfyUI or Diffusers.
2. Add a real image/identity evaluator for Character Remaster.
3. Run Character Remaster with a real source/reference pair.
4. Confirm candidate remains gated until identity/style evidence passes.
5. Run one live MRMIC process E2E using the same bridge contracts.

Only after those gates should EveAtelier claim a real generative MVP rather than an architecture-complete pre-MVP/basic-MVP foundation.
