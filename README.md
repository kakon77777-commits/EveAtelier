# EveAtelier

**EveAtelier** is an open-source, AI-native visual computational workbench.

The project is designed around a simple premise: AI should work with explicit visual meaning, typed operators, persistent visual state, replaceable execution providers, evaluation, and human art direction — not by treating a traditional GUI as the canonical control surface.

## Status

**Pre-MVP engineering.** The architecture has converged; implementation begins with open-source capability extraction and three acceptance paths:

1. background removal,
2. identity-preserving relighting,
3. character remastering.

## Architecture anchors

- **AADS vNext** — visual intelligence / controller
- **SEDB-Visual** — visual semantic knowledge authority
- **Operator Registry** — provider-neutral visual action language
- **RABCL** — visual workflow compiler
- **MRMIC/NVCL** — persistent visual world and observation/action runtime
- **Providers** — deterministic raster/vector, generation, physical/OFP, structure, analysis/validation

Core invariant:

`Operator != Provider != Provider Parameter Set`

## Engineering order

1. OSS Inventory
2. Extraction Matrix
3. License Boundary Audit
4. Deterministic Core Spike
5. Generation Spike
6. OFP-lite Spike
7. MRMIC Bridge
8. MVP acceptance scenarios

## License

Project license is not yet selected. Third-party components retain their own licenses; see `docs/oss/` for the pre-MVP reuse audit.

## Current engineering status

Pre-MVP provider and Workbench foundation is implemented on `integration/pre-mvp-oss-spikes`.

- OSS inventory / extraction / license audit: complete.
- Deterministic raster reference provider + OpenRaster: executable.
- ComfyUI / Diffusers provider boundaries: executable; real model runtime not available in the current validation container.
- OFP-lite relighting: executable approximation.
- MRMIC Phase 13 bridge: contract-level capability/portal/freshness integration.
- Basic acceptance scenarios: Background Removal PASS, Relight PASS within OFP-lite scope, Character Remaster PARTIAL because real generation + identity evaluation are not available in this environment.

See `docs/mvp/MVP_ACCEPTANCE_REPORT_v0.1.md` for exact evidence and non-claims.
