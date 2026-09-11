# EveAtelier v0.3 Visual Intelligence — Global Completion Contract

Date: 2026-09-11

Status: `ARCHITECTURE_BASELINE / LOCALLY_ACCEPTED_IMPLEMENTATION_CANDIDATE`

Baseline: `main@85c626456fc7369ee5610ef0247fdf7f9a76330a`

Canonical local roadmap:

```text
EveAtelier_Post_Basic_MVP_Remaining_Implementation_Roadmap_v0.1.md
SHA-256 DB97375516B42DEBCA5949F974D8D91D20B31F39A76F0CEB262F1F83A64EBF10
```

This contract completes the roadmap's bounded v0.3 milestone: Phase 5 AADS vNext,
Phase 6 RABCL Visual Workflow IR, and one real bridge into the deployed v0.2 Workbench
Core. It does not depend on the local roadmap path remaining present.

## 1. Product target

The accepted main path is:

```text
human visual intent
  -> provider-neutral visual constraints
  -> operator plan
  -> typed RABCL workflow
  -> bounded adaptive execution
  -> v0.2 Workbench candidates
  -> independent evaluation
  -> optional human gate
  -> policy-gated promotion
  -> close/reopen session resume
```

The product must decide what kind of visual work is needed without embedding Sharp,
ComfyUI, model, checkpoint, prompt, GUI, or vendor names into canonical AADS/RABCL
state.

## 2. Required AADS session model

`AadsVisualSession` persistently binds:

- goal and bounded task type;
- source human intent;
- compiled constraint packet;
- provider-neutral operator plan;
- RABCL workflow;
- initial ArtDocument identity, version, current-event revision and component-graph
  digest;
- project retrieval/context snapshot;
- candidate/evaluation/workflow state derived from events;
- explicit execution budget;
- explicit human-granted authority.

Session state is event-sourced and append-only. Chat history is not a resume
dependency. Closing and reopening SQLite must reconstruct the same workflow node,
outputs, budget use, decision history, wait state, and terminal outcome.

## 3. Human intent and constraint compiler

The bounded compiler accepts:

- natural-language instruction;
- optional task hint;
- positive, negative, identity, color, lighting, style, and structure references;
- like/dislike preferences;
- explicit human hard constraints and overrides.

It emits dimensions covering at least:

```text
identity structure style color lighting composition material
privacy locality cost latency human_review alpha edge
```

Constraint strengths remain explicit:

```text
HARD STRONG MEDIUM SOFT PREFERENCE
```

The first executable language controls are intentionally bounded:

```text
remove background / transparent background / no white fringe
relight / cool rear-left light / retain warm face light / preserve identity
```

Unsupported or ambiguous intent must compile to `UNKNOWN` with
`requiresHumanClarification=true`; it must not hallucinate an executable workflow.

## 4. Operator plan

The plan names exact active Operator Registry versions, purposes, target roles and
output roles. It never names Provider implementations. Missing, inactive or
incompatible operators fail before execution.

The first integrated control plans background removal through:

```text
CREATE_MASK -> CREATE_ALPHA -> EDGE_CLEANUP -> EVALUATE
-> HUMAN_GATE when required -> PROMOTE -> STOP
```

This path must enter the v0.2 dynamic Operator Registry and Workbench bridge. Direct
Sharp calls are not sufficient acceptance evidence.

## 5. RABCL Visual Workflow IR

RABCL is canonical workflow state, not a ComfyUI graph.

Required node kinds:

```text
OPERATOR EVALUATE HUMAN_GATE PROMOTE STOP
```

Required control behavior:

- sequential success edges;
- evaluation branches;
- failure/fallback branches;
- bounded retry or repair loops;
- provider rebind decision routing without naming a Provider;
- human pause and resume;
- explicit stop outcomes.

Every node has a finite visit bound. Every edge resolves to an existing node. At least
one terminal is reachable. Cycles are legal only because runtime/session budgets and
per-node visit bounds are mandatory.

Bindings may reference the initial ArtDocument state or prior node outputs. They may
not contain local filesystem paths, credentials, Provider state, or implicit chat
memory.

## 6. Adaptive decisions

The controller/runtime understands:

```text
ACCEPT REPAIR RESAMPLE REBIND RECOMPILE SWITCH_BACKEND ASK_HUMAN STOP
```

A failure decision may follow only an edge declared by the workflow and an outcome
allowed by the operator definition. A decision never grants promotion, retry, cost,
or Provider authority by itself.

`UNKNOWN_AFTER_DISPATCH` and exhausted budgets stop or wait for reconciliation. They
do not blind-retry.

## 7. Budgets and stop conditions

Each session carries finite non-negative bounds for:

```text
iterations
provider calls
candidates
repair loops
cost units
latency milliseconds
```

The runtime checks projected use before dispatch. Actual use is durably recorded.
When a bound is reached, execution appends a terminal budget event and makes no next
Provider call. Resume cannot reset consumed budget.

## 8. Authority

Only an exact human-authored authority grant may initialize a session. It declares
allowed actions and a promotion mode:

```text
FORBIDDEN
POLICY_GATED
```

AADS and RABCL may propose or execute only within that grant. Promotion still passes
through the ArtDocument evaluation/review/current-event gate. Neither a workflow node,
an AI decision, a Provider receipt, nor a worker-context projection can self-promote.

## 9. Project Context Home

Future external AI workers need a project-scoped semantic home before receiving
EveAtelier calls. v0.3 therefore persists an immutable, versioned context snapshot
containing bounded:

- project vocabulary;
- active Operator pack identities;
- ArtDocument/version/revision/graph identities;
- active session identities;
- evidence references;
- canonical authority-source labels.

A worker receives a digest-bound, allowlisted projection selected by a generic worker
profile. The projection:

- contains no image bytes, local paths, credentials or private conversation;
- is read-only and has `writeBack=false`;
- carries no evaluation, promotion, merge, release or deployment authority;
- does not bind any concrete external model or Provider into canonical state.

No GLM, MACR, Claude, Herdr or other external worker is called in this milestone.

## 10. v0.2 Workbench adapter

The adapter resolves RABCL bindings into v0.2 `ArtOperatorTarget` and Workbench request
objects. It derives deterministic operation/candidate/evaluation IDs from the session,
node and visit. It stores only stable asset/version/receipt identities as session
outputs; Provider paths and transient objects are excluded.

Evaluation is injected by exact evaluator identity. Human review remains a separate
input event. Promotion uses the current ArtDocument snapshot observed immediately
before the policy-gated call.

## 11. Acceptance controls

Required positive controls:

1. Chinese natural-language background-removal intent compiles to explicit alpha,
   edge, locality and identity constraints.
2. The controller builds an exact operator plan and RABCL workflow from an ACTIVE v0.2
   pack.
3. RABCL executes through real Sharp/libvips via the v0.2 Workbench.
4. A human-required document pauses at `HUMAN_GATE`, survives close/reopen, accepts one
   exact review, promotes, and terminates accepted.
5. Source CAS bytes remain exact and current changes only at PROMOTE.
6. Project Context Home emits a bounded read-only worker projection.

Required falsifying controls:

- unknown intent does not execute;
- Provider/model/prompt/workflow implementation fields cannot enter AADS constraints
  or RABCL operator parameters;
- dangling edges, unbounded visits, invalid bindings and unreachable terminals fail;
- stale initial ArtDocument state fails before Provider access;
- exhausted provider-call or candidate budget produces zero extra calls;
- a failure may not jump to an undeclared fallback;
- human gate cannot be bypassed by AI/system input;
- promotion-forbidden authority cannot reach PROMOTE;
- context projection cannot request unallowlisted sections or write-back;
- session event UPDATE/DELETE/REPLACE, alternate UNIQUE and implicit rowid attacks fail
  from a fresh SQLite connection;
- close/reopen reproduces event digests, node outputs, budget use and terminal state;
- all v0.2 and existing repository tests remain green.

## 12. Explicitly deferred

- open-ended natural-language understanding;
- SEDB-Visual learning, vector search or universal aesthetic memory;
- live external AI workers and worker write-back;
- generative Provider execution or automatic image resampling;
- full RABCL-to-ComfyUI/GEGL compilers;
- v0.4 Style Atlas and v0.5 human UI;
- strict rights-clear Real MVP evidence;
- release, binary distribution, public hosted runtime, or MOD production.

## 13. Completion definition

v0.3 is locally complete only when:

1. all required contracts, stores, compiler, planner, workflow runtime, context home,
   Workbench adapter and controller exist;
2. the complete background-removal control reaches human-approved promotion;
3. every budget/authority/resume boundary is durable and discriminative;
4. provider-neutral canonical state contains no implementation leakage;
5. focused and full-suite validation pass from a clean checkout;
6. no critical in-scope obligation remains unresolved.

Merge, publication or deployment remain separate actions after local acceptance.

## 14. Implemented bindings and evidence

The implementation binds this contract to:

```text
src/visual-intelligence/contracts.js
src/visual-intelligence/constraint-compiler.js
src/visual-intelligence/planner.js
src/visual-intelligence/session-store.js
src/visual-intelligence/rabcl-runtime.js
src/visual-intelligence/workbench-adapter.js
src/visual-intelligence/evaluators.js
src/visual-intelligence/context-home.js
src/visual-intelligence/controller.js
fixtures/visual_intelligence/
tests/visual-intelligence/
```

The detailed authority, recovery, context-home, adversarial and end-to-end evidence is
recorded in:

```text
docs/mvp/V03_VISUAL_INTELLIGENCE_ACCEPTANCE_v0.1.md
```

Final detached clean-worktree evidence on 2026-09-11:

```text
npm run check: checked_js=49 checked_python=true
npm ci: added 5 packages, audited 6 packages, 0 vulnerabilities
focused Visual Intelligence suite: 24/24 pass
full repository suite: 195 pass, 0 fail, 1 explicit live-MRMIC skip (196 total)
npm audit: 0 vulnerabilities
```

These results are local candidate evidence. They do not authorize or claim merge,
release, publication, deployment, live external runtime activity or external-worker
participation.
