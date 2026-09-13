# EveAtelier v0.5 Human Product Surface Acceptance

Date: 2026-09-13

Status: `IMPLEMENTATION_CANDIDATE / LOCAL_ACCEPTANCE`

Branch: `feature/v0.5-human-product-surface`

Base: `main@0da90a8791eb21df07cecb42aae84668a9ffcb31`

## Accepted product loop

```text
human intent
  -> explicit ReferenceRole binding
  -> server-owned policy / IDs / authority
  -> AADS compile and deterministic execution
  -> evaluated candidate while current remains unchanged
  -> human gate
  -> APPROVE -> canonical review -> AADS promotion -> new current
     or
     REJECT  -> canonical review -> durable stop -> original current retained
```

This is the first connected human product surface over the v0.2–v0.4 runtime. It is not
a chat-box image generator and the browser does not simulate clicks for AI control.

## Six roadmap surfaces

The local browser application implements:

1. Intent — natural language plus a bounded task hint;
2. Reference Board — explicit role-binding checkboxes over canonical SEDB references;
3. Canvas — exact current ArtDocument asset;
4. Candidate Compare — only evaluated/reviewable candidates, not intermediate passes;
5. History — merged Art current events and AADS event-chain projection;
6. Approve / Reject — available only at a current `WAITING_HUMAN` gate.

The interface is responsive, keyboard reachable, focus-visible and uses an ARIA live
status region. Runtime strings are inserted through text nodes rather than executable
HTML.

## Runtime boundary

`HumanWorkbenchSurface` is a projection and typed-command adapter. It receives injected
canonical stores, Controller, server-side policy, one bound human actor, clock and ID
factory. Browser commands cannot supply actor identity, Provider, model, workflow,
budget, authority or promotion data.

The surface adds read-only list projections to ArtDocumentStore and
VisualIntelligenceStore. Every write still travels through existing runtime methods:

```text
UI intent -> AadsController.startSession/run
UI review -> AadsController.submitHumanDecision/run
```

No UI method directly appends a version, evaluation, current event, knowledge record or
Provider receipt.

## Reference and asset boundary

Reference Board entries resolve `ReferenceAsset` and `ReferenceRole` records from the
requested project. The intent adapter converts selected role IDs through the existing
reference-driven binding and preserves rights-derived local-only constraints.

JSON projections contain AssetRef identity and a scoped URL only. The HTTP asset route
accepts project/document/asset IDs, proves that the asset belongs to a document version
or project reference, re-verifies AssetStore bytes and never accepts a filesystem path.

## Local HTTP boundary

- Node built-in HTTP; no new framework dependency;
- listener restricted to loopback;
- exact allowlist for `index.html`, `app.js` and `styles.css`;
- 64 KiB default JSON limit and required JSON content type;
- restrictive same-origin CSP and no-store project asset responses;
- public-safe errors without stacks or local paths;
- unknown routes, path traversal and out-of-scope assets return no file content.

## Synthetic runtime

`npm run workbench:demo` starts a complete local deterministic demonstration using:

- one code-generated 96×96 rights-clear synthetic source;
- real AssetStore, ArtDocumentStore, Operator Registry, AADS, RABCL and SEDB-Visual;
- the production `sharp@0.35.4` local deterministic Provider;
- the real background-removal evaluator and human-review promotion gate;
- isolated runtime files under the Git-ignored runtime artifact area.

No external AI, ComfyUI or MRMIC service is required or started.

## Browser-observed evidence

Evidence class: `BROWSER_OBSERVED_LOCAL / SYNTHETIC_SOURCE`

Approval control:

```text
page loaded all six surfaces
LINE reference role selected
Chinese intent submitted
one evaluated CLEAN_CANDIDATE shown
Canvas remained version:v05:source at WAITING_HUMAN
Approve recorded HUMAN_DECISION
PROMOTION appeared in History
Canvas/current changed to the exact evaluated candidate
document revision changed r1 -> r2
browser warnings/errors: 0/0
```

Rejection control used a fresh demo runtime:

```text
candidate reached WAITING_HUMAN
Reject recorded HUMAN_DECISION -> SESSION_STOPPED
candidate remained comparable
Canvas/current remained version:v05:source
document revision remained r1
browser warnings/errors: 0/0
```

## Automated validation

Latest local candidate gates:

```text
npm run check
  checked_js=61 checked_python=true

node --test tests/product-surface/*.test.js
  8 tests, 8 pass, 0 fail

npm test
  222 tests, 221 pass, 0 fail, 1 explicit opt-in live-MRMIC skip

npm audit --json
  total vulnerabilities = 0
```

The focused suite covers service projection, approval, rejection, command authority,
cross-scope failure, scoped bytes, loopback/body/content-type/static-path boundaries and
the six-surface DOM contract.

## AI participation

The v0.5 implementation and validation were performed by the primary Codex task. The
single governing Twin used earlier in this continuation was confined to v0.4 promotion
review and authored none of the v0.5 files. GLM, MACR and external workers were not
called and received no project context.

## Non-claims

- v0.5 is not merged, released or hosted by this acceptance record.
- Browser evidence uses a synthetic local demo, not the private Character Remaster pack.
- This is not strict rights-clear Real generative MVP closure.
- No Electron/Tauri/native installer or production authentication is included.
- No external generation, vector service, knowledge promotion, seed runtime, brush,
  animation, video, 3D or PSD-equivalent editor is claimed.
- Advanced layer/mask/Operator/Provider/Style/OFP inspectors remain later product slices.
