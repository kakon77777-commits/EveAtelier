# EveAtelier v0.3 Visual Intelligence Acceptance

Date: 2026-09-11

Status: `COMMITTED_IMPLEMENTATION_CANDIDATE / LOCAL_ACCEPTANCE`

Source branch: `feature/v0.3-visual-intelligence`

Base: `main@85c626456fc7369ee5610ef0247fdf7f9a76330a`

Canonical roadmap digest:

```text
DB97375516B42DEBCA5949F974D8D91D20B31F39A76F0CEB262F1F83A64EBF10
```

This report accepts the bounded v0.3 AADS vNext and RABCL runtime candidate. It does
not merge the branch, publish a release, deploy a hosted runtime, execute an external
AI worker, or claim open-ended visual intelligence.

## Accepted product slice

The candidate completes one connected control path:

```text
human natural-language intent
  -> typed multidimensional ConstraintPacket
  -> exact active provider-neutral OperatorPlan
  -> bounded RABCL workflow
  -> v0.2 WorkbenchExecutionBridge
  -> real Sharp/libvips outputs and immutable candidates
  -> independent alpha/edge/RGB evaluation
  -> durable human wait/review when policy requires
  -> ArtDocument promotion
  -> close/reopen session reconstruction
```

The implementation is in `src/visual-intelligence/`:

- `contracts.js` — strict canonical AADS, RABCL, context and session-event contracts;
- `constraint-compiler.js` — bounded human-language to semantic constraints;
- `planner.js` — exact Operator Registry plan and RABCL graph construction;
- `session-store.js` — append-only SQLite project/session/context home;
- `rabcl-runtime.js` — sequential, branch, fallback, bounded repair, human and stop loop;
- `workbench-adapter.js` — stable RABCL binding into v0.2 Workbench authority;
- `evaluators.js` — independent bounded background-removal validation;
- `context-home.js` — digest-bound allowlisted external-worker projection;
- `controller.js` — atomic session-bundle creation and runtime entrypoint.

## Constraint compiler classification

The compiler currently recognizes only bounded controls demonstrated by tests:

- remove/transparent background and no-white-fringe intent;
- relighting intent including rear-left cool light and retained warm face light;
- coarse recolor, resize and composite task classification.

Only background removal has an executable v0.3 plan in the current active pack.
Relighting is semantically compiled but fails planning honestly because the v0.2 pack
does not yet contain the required physical operators. Ambiguous text becomes
`UNKNOWN`, requires human clarification, creates no operator steps, and performs zero
Provider work.

## RABCL structural closure

The RABCL validator requires:

- finite per-node visit bounds;
- existing and reachable edges;
- a reachable terminal;
- data bindings whose producer kind matches the requested output;
- producer dominance over every consumer;
- workflow coverage for every planned operator;
- operator-declared fallback decisions only;
- Provider privacy policy no wider than the ConstraintPacket.

Canonical nodes contain no model, checkpoint, prompt, local path, ComfyUI node or
backend identity. The concrete Workbench adapter is downstream of the canonical graph.

## Session, authority and recovery closure

Every session binds the initial ArtDocument current version, document-event revision,
component-graph digest and optional Canvas revision. These are rechecked before every
operator dispatch and again after a human wait before promotion.

The human-authored authority grant explicitly lists permitted actions and decisions.
Promotion is either `FORBIDDEN` or `POLICY_GATED`; RABCL cannot grant itself promotion.
The session store independently rejects an event that skips `NODE_STARTED`, jumps to an
undeclared edge, forges node usage, fills a human gate outside its wait state, or uses
AI/system identity for the human decision.

Budgets persist exact totals for iterations, Provider calls, candidates, repair loops,
cost units and measured Provider latency. Preflight exhaustion causes zero additional
Provider calls. A retained `NODE_STARTED` without a terminal node event is treated as
unknown after dispatch on reopen, conservatively records the possible Provider call,
and never blind-retries.

Session creation is one SQLite transaction across intent, constraints, plan, workflow,
context, session and initial event. A late stale/context failure leaves none of that
bundle partially authoritative.

## Independent evaluator closure

The v0.3 background evaluator reads source and output independently and requires:

```text
same dimensions
transparent pixels > 0
opaque pixels > 0
source/output RGB changed pixels = 0
visible partial-alpha white fringe pixels = 0
```

A one-pixel RGB mutation and a one-pixel semi-transparent white fringe both produce
`REPAIR` in falsifying controls. This is a bounded deterministic control; it is not
general character-identity or aesthetic proof.

## Project Context Home

The same append-only SQLite home persists:

- versioned project glossary;
- exact Operator pack references;
- ArtDocument/version/revision/graph identities;
- session and evidence references;
- canonical authority-source labels;
- generic worker profiles;
- every exact context projection shown to a future worker.

The projection is rebuilt from the retained context/profile and compared byte-
semantically before append. It is allowlisted, size-bounded, path/secret safe, and
always records:

```text
writeBack = false
canEvaluate = false
canPromote = false
canMerge = false
canRelease = false
canDeploy = false
```

This gives future external workers a reconstructable project semantic home without
making any worker a resident, Provider, evaluator or project authority.

## Adversarial controls

| Control | Result |
|---|---|
| Unknown natural-language intent | terminal `NEEDS_HUMAN`, zero Provider calls |
| Provider/model/prompt/backend leakage in canonical params | rejected |
| Future/wrong-kind/non-dominating output binding | rejected |
| Planned operator omitted from workflow | rejected |
| Undeclared fallback or widened privacy | rejected |
| Provider/candidate budget zero | stops before node visit and dispatch |
| Declared repair loop | follows once, then durable budget stop |
| Adapter throw or crash after `NODE_STARTED` | terminal unknown/failure, no retry |
| Stale initial ArtDocument or stale state after human wait | rejected before dispatch/promotion |
| AI tries to fill human gate | rejected; session remains waiting |
| Promotion-forbidden authority | never visits PROMOTE; current unchanged |
| Forged worker projection content/write-back | rejected |
| Event update/delete/replace, alternate UNIQUE or implicit rowid | rejected from fresh SQLite connection |
| Close/reopen | exact digest chain, outputs, usage, wait and terminal state reconstructed |

## End-to-end acceptance

The primary human-required control uses a synthetic rights-clear 16x16 raster:

1. compile `把背景去掉，邊緣不要有白邊。`;
2. execute CREATE_MASK, CREATE_ALPHA and EDGE_CLEANUP through the active v0.2 Operator
   pack, capability matcher, Workbench bridge and Sharp provider;
3. create two immutable candidate ArtDocument versions without changing current;
4. independently accept alpha, RGB and fringe evidence;
5. pause at `HUMAN_GATE`;
6. close all four SQLite/CAS runtime stores;
7. reopen from disk with no chat-state dependency;
8. record one exact human approval;
9. promote through the existing ArtDocument gate;
10. reconstruct terminal `ACCEPTED` state and verify original source hash.

An additional automatic-deterministic policy control completes without fabricating a
human review and is accepted only because the evaluator kind is deterministic.

## Validation evidence

Final gates were replayed from a detached clean worktree of the committed candidate:

```text
npm run check
  checked_js=49 checked_python=true

npm ci
  added 5 packages; audited 6 packages; 0 vulnerabilities

node --test tests/visual-intelligence/*.test.js
  24 tests, 24 pass, 0 fail

npm test
  196 tests, 195 pass, 0 fail, 1 explicit opt-in live-MRMIC skip

npm audit --json
  total vulnerabilities = 0
```

## AI participation

This milestone was implemented and reviewed inline by the primary Codex task. Per the
user's instruction, GLM and MACR were not called. No other external AI worker received
project context, authored code, validated the result, or gained repository authority.

## Non-claims

- v0.3 is not merged or deployed by this report.
- No live ComfyUI, MRMIC, GLM, MACR or other external runtime was started.
- No private source/reference image or local research document was copied into Git.
- Relight, recolor, resize and composite classifications are not yet complete AADS
  executable plans.
- SEDB-Visual learning, Style Atlas, vector retrieval, external-worker write-back,
  open-ended language understanding and the human UI remain later milestones.
- Strict rights-clear Real MVP evidence remains a separate gate.

## Integration supersession

The preceding non-claims record the authority state at acceptance time. On 2026-09-12,
the user separately authorized continuation of the declared v0.3 integration gate.
Local `main` was fast-forwarded from
`85c626456fc7369ee5610ef0247fdf7f9a76330a` to the exact accepted source commit
`3a62eeba8e85d98b87e79defb4488f533152b79c`. The user's untracked research documents
and backup archive remained outside the merge. GitHub `main` publication is verified
separately after the integration documentation commit is pushed.
