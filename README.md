# EveAtelier

**EveAtelier** is an open-source, AI-native visual computational workbench.

The project is designed around a simple premise: AI should work with explicit visual meaning, typed operators, persistent visual state, replaceable execution providers, evaluation, and human art direction — not by treating a traditional GUI as the canonical control surface.

## Status

**Pre-MVP foundation with a measured private Basic MVP review batch.** The architecture, provider boundaries, evaluation, review gate, promotion gate, and MRMIC bridge are executable on `main`.

Current acceptance state:

- **Architecture / Workbench acceptance: PASS**
- **Private local Basic MVP generation/evaluation: PASS through the human-review gate**
- **Strict Real generative visual MVP: PARTIAL**

The current three acceptance paths are:

1. background removal — PASS,
2. identity-preserving relighting — PASS within OFP-lite scope,
3. character remastering — two real ComfyUI candidates generated and independently evaluated as `ACCEPT`; human review, promotion, candidate-specific MRMIC projection, and `rights_clear_real` evidence remain open.

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
- MRMIC Phase 13 bridge: capability, portal, freshness, transaction, readback, and prior live local create/patch/render verification.
- Workbench candidate staging, independent evaluation, durable human review, state resume, and promotion gate: executable.
- Full validation snapshot: 55 tests, 54 pass, 0 fail, 1 explicit opt-in live-MRMIC skip.
- Private source/reference and generated candidate image bytes remain Git-ignored and are not distributed by this repository.

See `docs/mvp/MVP_ACCEPTANCE_REPORT_v0.1.md` for the pre-MVP baseline and `docs/mvp/REAL_MVP_CHARACTER_REMASTER_ACCEPTANCE_v0.1.md` for current evidence and non-claims.

## Next real-MVP gate

1. Obtain the user's human review of the two staged Character Remaster candidates.
2. Promote only the selected accepted candidate, if any, while re-verifying source immutability.
3. Run candidate/promoted MRMIC projection and readback/render verification.
4. Replace the private game-research source pack with assets carrying sufficient rights evidence before claiming strict Real MVP PASS or public asset distribution.

## License

Project license is not yet selected. Third-party components retain their own licenses; see `docs/oss/` for the pre-MVP reuse audit.
