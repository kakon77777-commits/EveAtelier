# EveAtelier v0.5 Human Product Surface — Global Completion Contract

Date: 2026-09-13

Status: `ARCHITECTURE_BASELINE / LOCALLY_ACCEPTED_IMPLEMENTATION_CANDIDATE`

Baseline: `main@0da90a8791eb21df07cecb42aae84668a9ffcb31`

## 1. Product target

This milestone exposes the already-integrated EveAtelier runtime as a bounded human
art-workbench surface. A non-engineer must be able to:

```text
enter intent
-> choose explicit reference-role bindings
-> inspect the current canvas
-> compare candidates and evidence
-> inspect durable history
-> approve or reject at the exact human gate
```

It is not a Photoshop clone and not a chat-box wrapper around image generation.

## 2. Technology-domain choice

The first product surface is a local browser application served by the Node runtime:

- Node built-in HTTP keeps the UI next to the canonical runtime without introducing a
  second state authority;
- native browser HTML/CSS/ES modules keep the candidate small and portable;
- the server binds only to loopback;
- an Electron/Tauri/native packaging decision is deferred until product behavior is
  stable enough to justify the migration cost.

## 3. Authority partition

```text
Human UI              = intent and review command surface
HumanWorkbenchSurface = typed projection/command adapter
AADS Controller       = session and workflow authority
ArtDocumentStore      = document/version/current authority
SEDB-Visual           = reference/evidence authority
AssetStore            = image-byte authority
Provider              = execution only
```

The UI cannot directly write a document version, evaluation, current pointer,
knowledge record, Operator definition, Provider receipt, merge, release or deployment.

## 4. Required surface modules

### Workspace projection

Return one public-safe projection containing:

- current canvas asset;
- document versions and comparable candidates;
- exact evaluations and human reviews;
- reference cards and role bindings;
- active/waiting/completed AADS sessions;
- a merged chronological history of current-version and AADS events;
- review queue entries only for sessions actually waiting at a human gate.

No absolute local path or private image byte is serialized into JSON.

### Intent command

The browser may submit only human-level fields:

- project/document;
- natural-language intent and optional task hint;
- canonical reference-role binding IDs;
- like/dislike statements;
- hard constraints and explicit human overrides;
- retained retrieval-context IDs.

The server owns IDs, actor binding, Operator pack, Provider policy, budget, authority,
glossary and evidence baseline. Provider/model/workflow parameters are not accepted from
the browser.

### Review command

The browser may send `APPROVE` or `REJECT` plus a reason for a session currently in
`WAITING_HUMAN`. The server binds the configured human actor, records the canonical
ArtHumanReview through AADS, and resumes the workflow. It never calls promotion directly.
The command's project/document and retained session must all equal the Surface's single
authorized workspace before a human decision is recorded.

### Asset delivery

Image bytes are served only by exact AssetStore identity after proving that the asset
belongs to the requested project/document version or project reference card. Arbitrary
filesystem paths are never accepted.

## 5. Required browser layout

The first UI contains all six roadmap surfaces:

1. Intent;
2. Reference Board;
3. Canvas;
4. Candidate Compare;
5. History;
6. Approve / Reject.

The UI uses semantic DOM, keyboard-reachable controls, visible focus, status messages,
alt text and responsive layout. Untrusted content is inserted with text nodes, not HTML.

## 6. HTTP boundary

- loopback-only listener;
- exact static-file allowlist;
- bounded JSON request size;
- same-origin API;
- exact listener Host and optional Origin check before body parsing or command dispatch;
- restrictive Content Security Policy;
- method and content-type validation;
- public-safe error reasons without stack or filesystem disclosure;
- cache disabled for project image bytes.

## 7. Positive controls

1. Load a synthetic rights-clear demo project and reference board.
2. Submit the Chinese background-removal intent through HTTP.
3. Observe a real deterministic candidate while current remains the source.
4. See the session pause at `WAITING_HUMAN` and the candidate in Compare.
5. Approve through the UI adapter, resume AADS, and observe canonical promotion.
6. Run the same path with rejection and prove current remains unchanged.
7. Fetch exact candidate bytes through the scoped asset endpoint.

## 8. Falsifying controls

- client-supplied Provider/model/authority fields fail closed;
- cross-project document/reference/session access fails;
- an existing foreign-workspace waiting session cannot be reviewed or promoted;
- mixed-offset canonical instants remain in absolute chronological order;
- forged Host/Origin POST creates no session;
- review outside a current human gate fails;
- caller-supplied actor identity is impossible at the command schema;
- unknown asset identity and path traversal do not expose files;
- JSON projection contains no absolute path;
- candidate output never becomes current before AADS promotion;
- static UI has the six required surfaces and no direct store/provider calls.

## 9. Non-goals

- external AI, ComfyUI or live MRMIC startup;
- cloud hosting, remote authentication or collaboration;
- brush engine, animation, video, 3D or PSD parity;
- free-form workflow/Provider editing;
- knowledge/theory promotion UI;
- generation-seed integration;
- public distribution of private research assets.

## 10. Completion rule

v0.5 is a local implementation candidate only when the connected browser/server/runtime
path is implemented, focused tests and the full repository suite pass, a real browser
smoke exercises load -> intent -> compare -> human gate -> approve/reject, and no
blocking in-scope obligation remains. Test success does not self-authorize main merge or
deployment.

## 11. Local acceptance evidence

On 2026-09-13 the candidate completed:

```text
check: 61 JavaScript files + Python compile
focused product-surface suite: 11/11 pass
full repository suite: 224 pass, 0 fail, 1 explicit live-MRMIC skip (225 total)
npm audit: 0 vulnerabilities
real local browser: approve path PASS; reject path PASS; console warnings/errors 0/0
```

The exact browser evidence and non-claims are recorded in
`docs/mvp/V05_HUMAN_PRODUCT_SURFACE_ACCEPTANCE_v0.1.md`.
