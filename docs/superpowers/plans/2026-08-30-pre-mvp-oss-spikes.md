# EveAtelier Pre-MVP OSS Extraction and Provider Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate the pre-MVP EveAtelier provider foundation through OSS inventory, license isolation, deterministic raster operations, generation adapters, OFP-lite relighting, an MRMIC bridge, and three acceptance scenarios.

**Architecture:** EveAtelier owns provider-neutral Operator and Workbench contracts. External software is consumed only through explicit reuse modes: library, adapted code, isolated provider, reference-only, or clean reimplementation. MRMIC remains Canvas authority; provider outputs become staged/candidate artifacts and never own Workbench state.

**Tech Stack:** Node.js 22+, TypeScript, Vitest, sharp/libvips, JSZip/OpenRaster-compatible ZIP+XML manifests, Python 3 for optional Diffusers provider, HTTP for ComfyUI and MRMIC adapters.

**Spec:** `AI原生開源美術系統_統合內部論文_v0.2_2026-08-30.md` and Step 1–5 canonical convergence documents maintained outside this fresh repository.

## Global Constraints

- Operator != Provider != Provider Parameter Set.
- Source != Observation != Analysis != Projection != Judgment.
- Canvas state != Asset state != Semantic state != Provider state.
- Provider receipt != visual acceptance.
- All source-destructive visual mutation is source-preserving by default.
- GPL application code is not copied into EveAtelier core.
- Remote providers are optional; local-first privacy must be enforceable.
- No production code without a failing test first.

---

### Task 1: OSS inventory and extraction matrix

**Files:**
- Create: `docs/oss/OSS_INVENTORY_v0.1.md`
- Create: `docs/oss/EXTRACTION_MATRIX_v0.1.md`
- Create: `docs/oss/LICENSE_BOUNDARY_AUDIT_v0.1.md`

**Interfaces:**
- Consumes: upstream project metadata and Step 3 operator families.
- Produces: reuse classification used by all provider tasks.

- [ ] Record current upstream versions, licenses, languages, dependencies, operator coverage, and freshness.
- [ ] Classify each capability as `COPY_ADAPT`, `LIBRARY`, `EXTERNAL_PROVIDER`, `REFERENCE_ONLY`, or `REIMPLEMENT`.
- [ ] Record license-specific isolation rules, including GEGL per-operation licensing and GIMP/Krita/ComfyUI GPL boundaries.
- [ ] Commit.

### Task 2: TypeScript project and provider contracts

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/contracts.ts`
- Test: `tests/contracts.test.ts`

**Interfaces:**
- Produces: `VisualOperatorRequest`, `ProviderCapability`, `ProviderReceipt`, `VisualProvider`.

- [ ] Write failing contract validation tests.
- [ ] Run tests and verify RED.
- [ ] Implement minimal contracts and validators.
- [ ] Run tests and verify GREEN.
- [ ] Commit.

### Task 3: Deterministic raster provider

**Files:**
- Create: `src/providers/sharp-raster-provider.ts`
- Create: `src/openraster.ts`
- Test: `tests/sharp-raster-provider.test.ts`
- Test: `tests/openraster.test.ts`

**Interfaces:**
- Consumes: `VisualProvider`.
- Produces operators: crop, resize, create mask, create alpha, edge cleanup, recolor, layer composite.

- [ ] Write failing crop/resize tests and verify RED.
- [ ] Implement with sharp and verify GREEN.
- [ ] Write failing mask/alpha/edge cleanup tests and verify RED.
- [ ] Implement and verify GREEN.
- [ ] Write failing recolor/composite tests and verify RED.
- [ ] Implement and verify GREEN.
- [ ] Write failing ORA round-trip test and verify RED.
- [ ] Implement minimal OpenRaster 0.0.6 compatible writer/reader and verify GREEN.
- [ ] Commit.

### Task 4: Generation providers

**Files:**
- Create: `src/providers/comfyui-provider.ts`
- Create: `src/providers/diffusers-provider.ts`
- Create: `providers/python/diffusers_worker.py`
- Test: `tests/generation-providers.test.ts`

**Interfaces:**
- Produces `GENERATE`, `GENERATE_VARIATION`, `INPAINT` provider adapters.

- [ ] Write failing ComfyUI capability/probe/request mapping tests and verify RED.
- [ ] Implement HTTP adapter without bundling ComfyUI and verify GREEN.
- [ ] Write failing Diffusers subprocess contract tests and verify RED.
- [ ] Implement JSONL subprocess adapter and worker capability probe and verify GREEN.
- [ ] Run an optional real Diffusers tiny-pipeline smoke if runtime dependencies are available; record evidence separately.
- [ ] Commit.

### Task 5: OFP-lite provider

**Files:**
- Create: `src/providers/ofp-lite-provider.ts`
- Test: `tests/ofp-lite-provider.test.ts`

**Interfaces:**
- Produces: `INFER_NORMAL` and `RELIGHT` MVP operators over RGBA raster input.

- [ ] Write failing normal-field inference test and verify RED.
- [ ] Implement luminance-gradient approximate normal inference and verify GREEN.
- [ ] Write failing directional relight test and verify RED.
- [ ] Implement deterministic Lambert-style relight with warm-fill support and verify GREEN.
- [ ] Add structure/alpha preservation test and verify GREEN.
- [ ] Commit.

### Task 6: MRMIC bridge

**Files:**
- Create: `src/bridge/mrmic-client.ts`
- Test: `tests/mrmic-client.test.ts`

**Interfaces:**
- Consumes MRMIC `/api/capabilities` and transaction/resource-portal HTTP surfaces.
- Produces provider-neutral capability probe and portal/transaction request helpers without owning Canvas state.

- [ ] Write failing capability parsing and fail-closed tests.
- [ ] Implement capability probe.
- [ ] Write failing resource-portal mapping tests.
- [ ] Implement portal descriptor mapping preserving provider resource authority.
- [ ] Write failing stale/revision guard test.
- [ ] Implement expected-revision request guard.
- [ ] Commit.

### Task 7: Minimal workbench orchestrator

**Files:**
- Create: `src/workbench.ts`
- Test: `tests/workbench.test.ts`

**Interfaces:**
- Consumes provider registry and operator requests.
- Produces staged candidate artifacts, receipts, evaluation hooks, and promotion records.

- [ ] Write failing provider matching and candidate staging tests.
- [ ] Implement minimal registry + staged execution.
- [ ] Write failing receipt-not-acceptance test.
- [ ] Implement promotion gate.
- [ ] Commit.

### Task 8: MVP acceptance scenarios

**Files:**
- Create: `tests/acceptance/background-removal.test.ts`
- Create: `tests/acceptance/relight.test.ts`
- Create: `tests/acceptance/character-remaster.test.ts`
- Create: `docs/MVP_ACCEPTANCE_REPORT_v0.1.md`

**Interfaces:**
- Consumes deterministic, generation, OFP-lite, and Workbench components.
- Produces pre-MVP acceptance evidence.

- [ ] Write and run background-removal acceptance: mask → alpha → edge cleanup → validators → promotion.
- [ ] Write and run relight acceptance: infer normal → relight → alpha/structure preservation → promotion.
- [ ] Write and run character-remaster acceptance using a generation provider fixture plus optional real Diffusers smoke; require candidate staging and explicit promotion.
- [ ] Run full test suite and record exact counts.
- [ ] Record real-vs-fixture evidence boundaries honestly.
- [ ] Commit.
