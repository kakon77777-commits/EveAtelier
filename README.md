# EveAtelier

**EveAtelier** is an open-source, AI-native visual computational workbench.

The project is designed around a simple premise: AI should work with explicit visual meaning, typed operators, persistent visual state, replaceable execution providers, evaluation, and human art direction — not by treating a traditional GUI as the canonical control surface.

## Status

**v0.3 Visual Intelligence integration candidate over the deployed v0.2 core.** The
feature branch adds a persistent AADS session/controller, provider-neutral constraint
compiler and Operator Plan, bounded RABCL workflow runtime, and versioned Project
Context Home. `main` remains the published v0.2 Workbench Core until a separate v0.3
integration decision.

Current acceptance state:

- **Architecture / Workbench acceptance: PASS**
- **v0.2 Workbench Core local acceptance: PASS and integrated on `main`**
- **v0.3 Visual Intelligence local acceptance: PASS on the feature candidate**
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

- v0.3 AADS/RABCL: human visual intent compiles into explicit multidimensional
  constraints, an exact active Operator Plan, and a bounded workflow with sequential,
  evaluation, fallback, repair-loop, human-gate, promotion, and stop semantics.
- Event-sourced visual sessions: immutable SQLite history reconstructs node outputs,
  decisions, budget use, in-flight uncertainty, human wait state, and terminal outcome
  without relying on chat context.
- Project Context Home: versioned glossary/operator/document/session/evidence snapshots
  plus durable digest-bound worker projections with an explicit no-write/no-authority
  boundary. No external AI worker is invoked by this implementation.
- v0.3 background-removal evaluator: independently requires alpha separation, exact
  source/output dimensions and RGB preservation, and zero visible partial-alpha white
  fringe before acceptance.
- v0.2 Workbench Core: sealed immutable document-version graphs, content-addressed
  assets, exact component targeting, v2 provider hard filters, candidate-first commits,
  bounded fallback outcomes, group-aware compositing, spatial invalidation, and durable
  MRMIC pre-dispatch idempotency attempts.
- Production deterministic raster provider: exact `sharp@0.35.4` dependency over
  libvips with crop, resize, rotate, mask/alpha, localized edge cleanup, recolor,
  layer/group composite, format, filter, color/profile controls, and large-image proof.
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
- VUSD counterfactual evidence kernel: immutable pre-generation predictions and later observations; exact pack/axis/lock/minimal-closure validation; declared non-vacuous closure participation; explicit collateral deltas; derived residual comparison; and candidate-only operator proposals that cannot activate or promote themselves.
- Same-Series Calibration Evidence Kernel: immutable versioned dimension profiles; explicit legacy-v1 adaptation; data-defined additional dimensions; exact same-character and cross-character observations; repeated human preference rounds with retained disagreement; metric-limitation findings; terminal `PROPOSED` threshold candidates; and non-authorizing evidence summaries.
- Feature-candidate validation snapshot: 196 tests, 195 pass, 0 fail, 1 explicit
  opt-in live-MRMIC skip; `npm audit` reports zero known vulnerabilities.
- Private source/reference and generated candidate image bytes remain Git-ignored and are not distributed by this repository.

See `docs/mvp/MVP_ACCEPTANCE_REPORT_v0.1.md` for the pre-MVP baseline,
`docs/mvp/REAL_MVP_CHARACTER_REMASTER_ACCEPTANCE_v0.1.md` for current Real MVP evidence,
and `docs/style-control/SAME_SERIES_CALIBRATION_FOUNDATION_v0.1.md` for the uncalibrated
same-series contracts and non-claims. The Phase 2A design and evidence boundaries are in
`docs/superpowers/specs/2026-08-31-dynamic-operator-registry-kernel-design.md`; the VUSD Phase 2B
crosswalk is in `docs/superpowers/specs/2026-09-01-vusd-counterfactual-evidence-kernel-design.md`.
The v0.2 global completion contract is in
`docs/superpowers/specs/2026-09-11-v02-workbench-core-global-completion.md`, and its
acceptance/non-claim record is in `docs/mvp/V02_WORKBENCH_CORE_ACCEPTANCE_v0.1.md`.
The v0.3 completion contract and evidence are in
`docs/superpowers/specs/2026-09-11-v03-visual-intelligence-global-completion.md` and
`docs/mvp/V03_VISUAL_INTELLIGENCE_ACCEPTANCE_v0.1.md`.

## Next real-MVP gates

1. Review and integrate the exact v0.3 feature candidate without expanding it into
   open-ended language understanding or a Provider-specific workflow graph.
2. Begin the v0.4 SEDB-Visual / Style Atlas knowledge substrate so AADS can retrieve
   accepted references, rejected patterns, Provider evidence and project preferences.
3. Keep future external AI workers behind Project Context Home; no worker becomes
   canonical project, evaluation, promotion, merge, release, or deployment authority.
4. Keep Repair A as the private experimental current version; any further hand-only refinement must branch again and pass the same evaluation/human-review gate.
5. Replace the private game-research source pack with assets carrying sufficient rights evidence before claiming strict Real MVP PASS or public asset distribution.

## License

Project license is not yet selected. Third-party components retain their own licenses; see `docs/oss/` for the pre-MVP reuse audit.
