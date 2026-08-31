# EveAtelier

**EveAtelier** is an open-source, AI-native visual computational workbench.

The project is designed around a simple premise: AI should work with explicit visual meaning, typed operators, persistent visual state, replaceable execution providers, evaluation, and human art direction — not by treating a traditional GUI as the canonical control surface.

## Status

**Pre-MVP foundation with a measured private Basic MVP review batch.** The architecture, provider boundaries, evaluation, review gate, promotion gate, and MRMIC bridge are executable on `main`.

Current acceptance state:

- **Architecture / Workbench acceptance: PASS**
- **Private local Basic MVP: PASS through human review, promotion, and candidate-specific MRMIC verification**
- **Strict Real generative visual MVP: PARTIAL**

The current three acceptance paths are:

1. background removal — PASS,
2. identity-preserving relighting — PASS within OFP-lite scope,
3. character remastering — two real ComfyUI candidates were generated and independently evaluated as `ACCEPT`; Candidate 02 was then repaired through an explicit 18.82% mask. Repair A is now `PRIVATE_EXPERIMENTAL_CURRENT` after `ACCEPT_WITH_WARNINGS`, Workbench promotion, and live local MRMIC readback/render. Repair B and Candidate 01 remain alternates; `rights_clear_real` evidence remains open.

## Architecture anchors

- **AADS vNext** — visual intelligence / controller
- **SEDB-Visual** — visual semantic knowledge authority
- **Operator Registry** — provider-neutral visual action language
- **RABCL** — visual workflow compiler
- **MRMIC/NVCL** — persistent visual world and observation/action runtime
- **Providers** — deterministic raster/vector, generation, physical/OFP, structure, analysis/validation

Core invariant:

`Operator != Provider != Provider Parameter Set`

Additional runtime invariants demonstrated by the current spike:

- `Provider receipt != visual acceptance`
- `Execution != canonical promotion`
- `MRMIC projection != provider resource ownership`
- stale revision fails closed
- source-preserving mutation is the default

## Engineering order

The initial pre-MVP engineering sequence has been executed:

1. OSS Inventory
2. Extraction Matrix
3. License Boundary Audit
4. Deterministic Core Spike
5. Generation Spike
6. OFP-lite Spike
7. MRMIC Bridge
8. MVP acceptance scenarios

## Current implementation

- OSS inventory / extraction / license audit: complete.
- Deterministic raster reference provider + OpenRaster: executable.
- ComfyUI external provider: real local CUDA execution verified with a pinned SD1.5 image-to-image workflow.
- Diffusers provider: explicit-model, local-files-only fallback boundary implemented; not used for the measured review batch.
- Character Remaster evaluator: real local SigLIP inference plus deterministic line/color/artifact measurements, with calibration limitations recorded.
- Multiple negative references are preserved without selecting a fake primary.
- OFP-lite relighting: executable approximation.
- MRMIC Phase 13 bridge: capability, portal, freshness, transaction, and candidate-specific live local create/patch/readback/render verification.
- Workbench candidate staging, independent evaluation, durable human review, state resume, and promotion gate: executed for Candidate 02 and its localized Repair A child with warnings.
- Localized repair: pinned SD1.5 core-node workflow, explicit mask upload, current-parent lineage, deterministic locality evidence, zero outside-mask pixel changes, human review, and live MRMIC promotion verified for Repair A.
- Experimental style-control foundation: provider-neutral `StyleConstraintPacket`, six-dimensional `SameSeriesObservation`, and project-local human pairwise preference contracts; uncalibrated observations always remain `UNVERIFIED`.
- Dynamic Operator Registry Kernel: data-loaded axes, locks, families and compiler rules; immutable version digests; REPLACE-safe append-only SQLite evidence; human-gated activation; provider-neutral semantic plans; revision-guarded exact provider receipts; store-issued runtime evidence tokens; PREPARED/COMPLETED/FAILED experience events; and a real registry-bound Pillow resize green control.
- Full validation snapshot: 121 tests, 120 pass, 0 fail, 1 explicit opt-in live-MRMIC skip.
- Private source/reference and generated candidate image bytes remain Git-ignored and are not distributed by this repository.

See `docs/mvp/MVP_ACCEPTANCE_REPORT_v0.1.md` for the pre-MVP baseline,
`docs/mvp/REAL_MVP_CHARACTER_REMASTER_ACCEPTANCE_v0.1.md` for current Real MVP evidence,
and `docs/style-control/SAME_SERIES_CALIBRATION_FOUNDATION_v0.1.md` for the uncalibrated
same-series contracts and non-claims. The Phase 2A design and evidence boundaries are in
`docs/superpowers/specs/2026-08-31-dynamic-operator-registry-kernel-design.md`.

## Next real-MVP gates

1. Keep Repair A as the private experimental current version; any further hand-only refinement must branch again and pass the same evaluation/human-review gate.
2. Calibrate the six-dimensional same-series evaluator with repeated exact-pair observations, counterexamples, evaluator provenance, and human disagreement records; the current 1086 benchmark intake is private and uncalibrated.
3. Replace the private game-research source pack with assets carrying sufficient rights evidence before claiming strict Real MVP PASS or public asset distribution.

## License

Project license is not yet selected. Third-party components retain their own licenses; see `docs/oss/` for the pre-MVP reuse audit.
