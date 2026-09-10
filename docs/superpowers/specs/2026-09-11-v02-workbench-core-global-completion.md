# EveAtelier v0.2 AI-Native Workbench Core — Global Completion Contract

Date: 2026-09-11

Status: `ARCHITECTURE_BASELINE / LOCALLY_ACCEPTED_IMPLEMENTATION_CANDIDATE`

Baseline: `main@e676a545f451f1f4820ceb07cb9fbe3992632a98`

Canonical roadmap source observed locally:

```text
EveAtelier_Post_Basic_MVP_Remaining_Implementation_Roadmap_v0.1.md
SHA-256 DB97375516B42DEBCA5949F974D8D91D20B31F39A76F0CEB262F1F83A64EBF10
```

The source package is local research intake and is not copied into the public tree.
This completion contract restates every in-scope v0.2 obligation needed for a clean
checkout; implementation does not depend on the external path remaining present.

## 1. Product target

This milestone completes the roadmap's first general-purpose workbench core. It turns
the successful Basic MVP vertical loop into reusable infrastructure:

```text
typed operator
  -> provider capability binding
  -> resolved ArtDocument target
  -> source-preserving execution
  -> content-addressed output asset
  -> immutable candidate document version
  -> evaluation/review gate
  -> current-version event
  -> optional MRMIC projection
```

This is an AI-first runtime milestone. A human GUI is not required for completion.

## 2. Global scope

The requested whole is the roadmap's `v0.2 — AI-Native Workbench Core`:

1. complete the in-scope Phase 2 Operator Runtime contract and bridge;
2. implement Phase 3 Art Document Runtime v1;
3. implement Phase 4 production deterministic raster execution with `sharp/libvips`;
4. prove one end-to-end operator-to-document path and retain the existing scenarios.

The milestone is incomplete if only one local subsystem is polished while the main
operator-to-document path remains disconnected.

Phase 2 completion also requires typed preconditions, postconditions, failures and
preservation expectations for the in-scope catalog, plus bounded outcomes for
`REBIND`, `RESAMPLE`, `REPAIR`, `RECOMPILE_REQUEST`, `SWITCH_BACKEND` and `ASK_HUMAN`.
These outcomes may be returned to a future controller; they do not require AADS or
RABCL to exist in this milestone.

## 3. Explicitly deferred

- AADS vNext controller;
- RABCL branching workflow compiler;
- SEDB-Visual / Style Atlas integration;
- human Workbench UI;
- RVGR L1/L2 sampling observation or rewrite;
- Composable Visual Runtime sister project;
- generation-seed runtime integration;
- PSD parity, brush engine, animation, cloud collaboration, publishing and MOD output.

The recently added same-series calibration store is retained as a deferred Phase 7
precursor. It is not the current milestone, does not become SEDB authority, and must not
be imported into the Art Document hot path.

## 4. Canonical authority

| State | Authority |
|---|---|
| Raster/vector/layer/mask bytes | local content-addressed Asset Store |
| Art project/document/version/component metadata | Art Document Store |
| Current document pointer | append-only document-current events |
| Operator meaning and version | existing Operator Registry |
| Provider native execution state | selected Provider |
| Canvas object graph and revision | MRMIC CanvasStore |
| Evaluation and human review | their existing typed evidence records |

Hard invariants:

```text
Canvas State != Asset State != Art Document State != Provider State
Canvas Revision != Document Version != Provider Revision
Operator != Provider != Provider Parameters
Semantic Region != Pixel Mask
Provider Receipt != Evaluation != Promotion
Source bytes are never overwritten
MRMIC projection never transfers asset ownership
```

## 5. Required modules

The implementation may refine filenames, but it must preserve these separations.

### 5.1 AssetStore

Responsibilities:

- register an existing source file without mutating it;
- copy or stream bytes into an injected local CAS root;
- identify immutable bytes as `asset:sha256:<digest>`;
- expose verified metadata and a read locator;
- register derived output with parent asset IDs and execution identity;
- verify retained hashes on reopen;
- never own semantic meaning, Canvas geometry or Provider state.

Tests use temporary directories. Production paths are injected and never hard-coded.

### 5.2 ArtDocumentStore

Persist with `node:sqlite` and strict canonical JSON boundaries.

Required records:

- `ArtProject`;
- `ArtDocument`;
- `ArtDocumentVersion`;
- `ArtAssetBinding`;
- `ArtLayer` and `LayerGroup`;
- `ArtMask`;
- `ArtSelection`;
- `ArtRegion`;
- `ArtStructureBinding`;
- `ArtFieldBinding`;
- append-only current-version / promotion / restore events.

Definitions and versions are immutable. Components belong to an exact immutable
document version. Promotion changes the derived current pointer by appending an event;
it does not rewrite a version row.

### 5.3 TargetResolver

Accept stable targets for:

```text
document
document_version
layer
mask
selection
region
structure
field
```

It resolves exact project/document/version/component identities and freezes:

- document version;
- primary asset ID and SHA-256;
- component identity and revision where applicable;
- expected MRMIC Canvas revision when supplied.

Requests and resolved targets keep `expectedDocumentVersion`, document-event revision,
component revision and `expectedCanvasRevision` distinct. After Provider return and
before candidate commit, the resolver repeats the document/component/current checks.
A stale result may be retained only as an explicitly detached candidate by policy; it
must never blind-promote.

Missing, cross-document, cross-version or stale identities fail before Provider access.
Semantic regions may reference a mask, geometry or unresolved representation; they are
not silently treated as pixel masks.

### 5.4 WorkbenchExecutionBridge

Responsibilities:

1. resolve an ACTIVE exact operator version;
2. resolve/freeze the ArtDocument target;
3. check operator input kind and authority;
4. select a compatible provider from capability manifests;
5. compile only the selected provider's request;
6. execute once;
7. verify receipt identity and output bytes;
8. register output in AssetStore;
9. append an immutable candidate version and lineage;
10. request evaluation/review;
11. append promotion only when existing policy permits;
12. optionally call `MrmicClient` after document commit and verify portal readback.

MRMIC projection is a post-document side effect. If it fails or becomes
`UNKNOWN_AFTER_DISPATCH`, the committed document remains canonical, projection status
is recorded separately, and no blind retry or duplicate portal is allowed.

The bridge does not implement AADS planning or RABCL branching. It executes one already
chosen typed operator request.

### 5.5 Legacy compatibility

Existing `EveAtelierWorkbench`, Character Remaster CLI and acceptance tests must remain
usable. New work must not create a second current-version authority for the same new
project. A compatibility facade may translate old calls into the new store, or legacy
v1 may remain explicitly isolated while all new v0.2 acceptance uses one
ArtDocumentStore. Silent mixed authority is forbidden.

## 6. Production deterministic provider

`sharp@0.35.4` is the pinned Node facade over libvips. Version 0.35.3 was rejected
after npm reported the bundled libheif high-severity advisory fixed by 0.35.4. It must
be a real execution
dependency for the production provider, not only an availability probe.

Required first-pass operations:

```text
visual.op.raster.crop
visual.op.raster.resize
visual.op.raster.rotate
visual.op.raster.create_mask
visual.op.raster.create_alpha
visual.op.raster.edge_cleanup
visual.op.raster.recolor
visual.op.composite.layer_composite
visual.op.raster.convert_format
visual.op.raster.basic_filter
```

The provider must cover blend mode, opacity, masks and group-oriented compositing for
the v0.2 layered-document path; preserve or explicitly convert color profile metadata;
and demonstrate a bounded large-image operation. LittleCMS-level advanced proofing and
FastFloat remain later work, but color-space/profile handling may not be silently
discarded.

The existing Pillow provider remains a reference/fallback/test provider and must keep
its honest identity. Provider-specific sharp options stay in the adapter; canonical
Operator semantics and ArtDocument state do not import libvips names.

The dependency lock and license notices must be reproducible. This milestone does not
embed GIMP, Krita, GEGL or ComfyUI code.

## 7. Minimum operator catalog bridge

The existing dynamic registry remains authoritative. Add a versioned MVP pack or
adapter containing only the operators required by the integrated deterministic path.
Do not add hundreds of speculative operators.

The provider capability manifest must advertise exact operator versions and real
evidence maturity. A sharp capability cannot be `AVAILABLE` when the dependency probe
or operation support is absent.

The v0.2 capability shape must additionally expose supported input/output kinds,
locality, determinism, reproducibility, maximum resolution, alpha/layer/structure/
reference/seed/batch support, runtime identity, license/policy class and
`lastVerifiedAt`. The matcher performs these hard filters before evidence/latency/cost
ranking. A compatibility projection may feed the existing v1 executor after v0.2
filtering; it may not bypass the added constraints.

## 8. End-to-end acceptance

The primary green control is a synthetic, rights-clear background-removal document:

```text
source register
  -> document v0
  -> CREATE_MASK
  -> CREATE_ALPHA
  -> EDGE_CLEANUP
  -> deterministic validation
  -> candidate version
  -> policy-authorized promotion event
  -> close/reopen
  -> exact current version and lineage readback
```

At least one operation must enter through the dynamic Operator Registry and provider
matcher rather than calling the sharp adapter directly. Source hash must remain exact.

Additional required controls:

- target resolution for layer, mask and semantic region;
- target resolution for first-class selection, structure and field;
- cross-version and stale-target rejection before Provider execution;
- provider receipt cannot self-promote;
- a target/current/component change during Provider execution cannot update current;
- geometry-only or unresolved semantic regions cannot masquerade as a pixel mask;
- failed execution creates no candidate/current event;
- human-required candidate cannot promote without exact review;
- optional MRMIC projection preserves `provider=external`,
  `resourceKind=artifact`, `ownershipTransferred=false`;
- SQLite close/reopen reconstruction;
- source mutation after registration does not alter CAS bytes; CAS tampering fails on
  read and reopen;
- receipt hash mismatch or CAS registration failure creates no candidate/current event;
- direct SQL update/delete/replace rejection on immutable history;
- all existing repository tests remain green.

## 9. Validation topology

Apply global-first completion:

1. instantiate every required module and connect the complete rough path;
2. run one focused/global validation pass;
3. group failures by root cause;
4. repair related failures in batches;
5. run targeted checks for repaired areas;
6. run one final full repository gate.

Do not run the entire suite after each small edit. Do not substitute validation volume
for missing system coverage.

## 10. GLM worker contract

`glm_flash_worker/glm-5.3-flash` may author code-text and tests as unverified
candidates. It has:

```text
write_scope = []
patch authority = false
tools = none
repository mutation authority = false
merge/release/deployment authority = false
```

Each candidate task receives this architecture contract plus the minimum relevant
public source projection. Candidate Vault readback is required. The local architect:

- selects or rejects candidate files;
- applies changes with repository tools;
- executes tests;
- narrows claims;
- owns commit and integration decisions.

GLM review repetition is event-driven: first whole implementation, observed global
failures, a materially revised diff, or closure readiness. It is not an arbitrary test
quota.

## 11. Completion definition

The milestone is complete only when all are true:

1. AssetStore, ArtDocumentStore, TargetResolver and WorkbenchExecutionBridge exist;
2. one exact typed operator travels end-to-end through them;
3. the production sharp provider executes the required deterministic catalog;
4. source preservation, candidate-first commit and promotion authority are enforced;
5. document/layer/mask/selection/region/structure/field identities are persistently
   addressable;
6. close/reopen replay reconstructs current version and lineage;
7. MRMIC remains Canvas authority and asset ownership remains external;
8. existing Basic MVP paths still pass;
9. focused and final global validation pass;
10. no critical in-scope obligation remains unresolved.

The dependency graph must include an exact reproducible sharp version, lockfile and
applicable Apache-2.0/libvips notice boundary before the production-provider claim.

Rights-clear Character Remaster closure, AADS, RABCL, SEDB-Visual and UI remain
separately reported future work and do not block this finite milestone.

## 12. Implemented closure bindings

The implementation candidate binds the abstract responsibilities to these public
modules:

```text
src/art-domain/contracts.js
src/art-domain/asset-store.js
src/art-domain/store.js
src/art-domain/target-resolver.js
src/art-domain/provider-capability.js
src/art-domain/workbench-runtime.js
src/art-domain/interchange.js
src/providers/sharp-raster-provider.js
fixtures/operator_runtime/v02-deterministic-pack.example.json
```

Every ArtDocumentVersion component graph is sealed before it can become current. The
seal contains a canonical component digest, count, parent digest, and explicit
`SOURCE_GRAPH`, `COPY_FORWARD`, or `INVALIDATE_SPATIAL` policy. API and SQLite guards
reject later component insertion. Target resolution and the candidate commit both
verify the same sealed digest.

Spatially structural operations invalidate old layer/mask/selection/region/structure/
field bindings instead of silently reusing invalid coordinates. Pixel-mask consumers
require exact dimensions. Group composite is compiled from the sealed layer tree and
executes visibility, opacity, blend, and mask semantics through the production Sharp
provider.

Projection now has a durable pre-dispatch attempt ledger. A prepared attempt without a
terminal outcome becomes `UNCERTAIN` on replay and never self-authorizes a retry.

## 13. Acceptance record

The detailed review, promotion, MRMIC classification, third-party boundary, validation
evidence, and non-claims are recorded in:

```text
docs/mvp/V02_WORKBENCH_CORE_ACCEPTANCE_v0.1.md
```

Final detached clean-worktree evidence on 2026-09-11:

```text
npm run check: checked_js=40 checked_python=true
npm ci: added 5 packages, audited 6 packages, 0 vulnerabilities
focused ArtDocument suite: 25/25 pass
full repository suite: 171 pass, 0 fail, 1 explicit live-MRMIC skip (172 total)
npm audit: 0 vulnerabilities
Governing Twin: MSSP ACCEPT / CONCUR; behavioral, structural, discriminative PASS
```

These counts are candidate evidence, not merge/release/deployment authority. They are
rebound to the final commit by the clean-checkout replay described in the acceptance
report.
