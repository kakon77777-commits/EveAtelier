# EveAtelier

**EveAtelier** is an open-source, AI-native visual computational workbench.

The project is designed around a simple premise: AI should work with explicit visual meaning, typed operators, persistent visual state, replaceable execution providers, evaluation, and human art direction — not by treating a traditional GUI as the canonical control surface.

## Status

**Pre-MVP / basic-MVP foundation.** The architecture has converged and the first executable provider/workbench spikes are now on `main`.

Current acceptance state:

- **Architecture / Workbench acceptance: PASS**
- **Real generative visual MVP: PARTIAL**

The current three acceptance paths are:

1. background removal — PASS,
2. identity-preserving relighting — PASS within OFP-lite scope,
3. character remastering — PARTIAL pending a real generation runtime and real identity/style evaluation.

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
- ComfyUI / Diffusers provider boundaries: executable; real model runtime was not available in the validation container.
- OFP-lite relighting: executable approximation.
- MRMIC Phase 13 bridge: contract-level capability / portal / freshness integration.
- Workbench candidate staging, independent evaluation, and promotion gate: executable.
- Full validation snapshot: 20 tests, 20 pass, 0 fail, 0 skipped.

See `docs/mvp/MVP_ACCEPTANCE_REPORT_v0.1.md` for exact evidence and non-claims.

## Next real-MVP gate

1. Run one real Generation Provider: ComfyUI or Diffusers.
2. Add a real image / identity evaluator for Character Remaster.
3. Run Character Remaster with a real source / reference pair.
4. Confirm candidate promotion remains gated until identity / style evidence passes.
5. Run one live MRMIC process E2E using the same bridge contracts.

## License

Project license is not yet selected. Third-party components retain their own licenses; see `docs/oss/` for the pre-MVP reuse audit.
