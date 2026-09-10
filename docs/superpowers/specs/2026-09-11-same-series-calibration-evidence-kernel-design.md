# Same-Series Calibration Evidence Kernel Design

Date: 2026-09-11

Phase: 2C

Status: `IMPLEMENTED_EXPERIMENTAL / UNCALIBRATED / CANDIDATE_ONLY`

## Goal

Turn the existing six-dimension `SameSeriesObservation` and project-local human
preference contracts into durable calibration evidence without allowing the evidence
collector, an evaluator, or an AI proposal to declare calibration, activation, visual
acceptance, Workbench promotion, or MRMIC mutation.

The kernel must allow future art theory to add versioned dimensions without modifying
its lifecycle or authority code. It is an EveAtelier evidence layer, not the separate
Composable Visual Runtime and not a generation-seed runtime.

## Existing boundary retained

The following v1 behavior is unchanged:

- `StyleConstraintPacket` remains provider-neutral and experimental.
- `SameSeriesObservation` still requires all six original dimensions.
- a valid legacy observation still classifies as `UNVERIFIED` with
  `same_series_thresholds_not_calibrated`;
- `HumanPairwisePreference` remains project-local evidence, separate from acceptance;
- the private 1086 intake is neither an exact same-character pair nor calibration data.

The Phase 2C adapter validates the old record first, then maps it explicitly into the
new profile-bound observation. No record is silently upgraded or reinterpreted.

## Data flow

```text
versioned dimension profile
  -> exact pair or cross-character observation
  -> repeated project-local preference rounds
  -> false-positive / metric-blindness finding
  -> immutable threshold candidate (PROPOSED only)
  -> advisory evidence summary (never authority)
```

## Versioned dimension profiles

`eve-atelier-same-series-dimension-profile/v1` contains:

- stable profile ID and semantic version;
- constant maturity `EXPERIMENTAL_UNCALIBRATED`;
- versioned dimension definitions;
- an allowed status vocabulary per definition.

The six original dimensions remain required as the compatibility floor. Later profile
versions may add dimensions. Observations bind the exact profile digest and must cover
every definition exactly once with the matching definition version. An added dimension
therefore needs no lifecycle-code change and cannot alter retained v1 evidence.

## Calibration observations

`eve-atelier-calibration-observation/v1` separates:

- exact profile identity;
- project-local scope;
- `SAME_CHARACTER_EXACT_PAIR` or `CROSS_CHARACTER_COUNTEREXAMPLE` relation;
- opaque project-local character bindings;
- exact left/right/reference artifact IDs and SHA-256 identities;
- one measurement per profile dimension;
- evaluator identity, version, method, limits, evidence references, and strict timestamp.

Same-character records require equal character bindings. Counterexamples require
different bindings. Left and right artifacts must be distinct bytes. Paths, URLs and
image bytes are not fields in the contract.

Character bindings are asserted project-local references in this phase. No global
identity authority or new person/resident identity system is claimed.

## Preferences and disagreement

`eve-atelier-calibration-preference/v1` binds one human observation to:

- an existing calibration observation;
- its exact artifact pair, profile, and scope;
- a named round and task-local observer;
- one of `LEFT`, `RIGHT`, `TIE`, or `NEITHER`;
- evidence references and a strict timestamp after the observation.

One observer can submit at most once per observation and round. Multiple observers may
disagree. The summary counts choices and reports `disagreement: true`; it deliberately
does not compute a winner, consensus percentage, acceptance, or calibration decision.

## Findings and threshold candidates

`eve-atelier-calibration-finding/v1` records either `FALSE_POSITIVE` or
`METRIC_BLINDNESS` against exact observations in the same profile and scope.

`eve-atelier-threshold-candidate/v1` stores only:

- an immutable method/version and parameter-set digest;
- exact observation, preference, finding, evidence, and counterevidence references;
- limitations and proposer provenance;
- constant terminal status `PROPOSED`.

A candidate must include both same-character and cross-character evidence, repeated
preference rounds for at least one included observation, and retained limitation
findings. All referenced evidence must belong to the same exact profile and scope, and
the proposal timestamp must follow it. The store exposes no activation method.

The candidate payload itself remains outside this metadata kernel and is identified by
digest. This permits future calibration algorithms without embedding provider knobs,
model code, or one fixed mathematical method in the evidence lifecycle.

## Persistence and replay

The Node `node:sqlite` store uses strict tables for profiles, observations, preferences,
findings, and threshold candidates. Database triggers reject `UPDATE`, `DELETE`, and
`INSERT OR REPLACE` against every immutable table. Same-ID same-content append is an
idempotent replay; same-ID drift is rejected.

Inputs are normalized as canonical JSON before any SQLite side effect. Inherited or
accessor-backed objects, sparse arrays, symbols, cycles, non-finite numbers, negative
zero, invalid hashes, malformed full RFC3339 instants, and schema drift fail closed.
Close/reopen tests verify exact retained records.

Evidence summaries count distinct artifact pairs, preference rounds, disagreement
rounds, limitation findings, and candidates. Every summary returns:

```json
{
  "calibrationStatus": "EXPERIMENTAL_UNCALIBRATED",
  "authority": {
    "calibration": false,
    "activation": false,
    "visualAcceptance": false,
    "workbenchPromotion": false,
    "mrmicMutation": false
  }
}
```

Counts are inventory, not progress authority and not evidence that a threshold is good.

## Bounded GLM review

One MACR `glm_flash_worker/glm-5.3-flash` task reviewed the public contract summary as
an `unverified_candidate`. It returned HTTP 200 with no retry or fallback. Candidate
Vault readback preserved `19,718` UTF-8 bytes with SHA-256
`4fdbf77889cb9efb998ade209a484645c223985f1f3593556d770c3176696f63`.

Adopted after local review:

- immutable versioned definitions;
- append-only evidence;
- explicit counterexamples and metric limitations;
- disagreement preservation;
- terminal `PROPOSED` threshold candidates;
- an advisory non-authorizing summary.

Narrowed or deferred:

- no new identity registry;
- no automatic binding to Operator Registry actors;
- no round-open/round-close state machine;
- no Contest/Supersede record type yet;
- no numeric readiness threshold;
- no threshold fitting, independent-review workflow, calibration activation, UI,
  generation, Workbench promotion, or MRMIC mutation.

The GLM candidate did not authorize the implementation. RED tests, local contract
inspection, SQLite replay, the full repository suite, and human authority remain
separate gates.

## Closure claims

- Behavioral: the synthetic Phase 2C append, replay, disagreement, dynamic-dimension,
  counterevidence and candidate-only paths are executable.
- Structural: evidence is bound to immutable definitions, exact artifact bytes, scope,
  provenance, time, and cross-record references within the tested SQLite boundary.
- Discriminative: tests reject private-path leakage, invalid time, profile/dimension
  drift, wrong character relation, duplicate artifact bytes, dangling or cross-closure
  evidence, premature proposals, SQL mutation and replacement attacks.

## Explicit non-claims

- No real threshold has been proposed, calibrated, accepted, or activated.
- No new real image was evaluated.
- No 1086 image or private Real MVP byte entered tracked fixtures.
- No evaluator accuracy, false-positive rate, cross-character generalization, or human
  agreement level was measured.
- No separate Composable Visual Runtime or generation-seed runtime was implemented.
