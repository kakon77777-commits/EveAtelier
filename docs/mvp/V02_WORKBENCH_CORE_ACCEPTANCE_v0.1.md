# EveAtelier v0.2 Workbench Core Acceptance

Date: 2026-09-11

Status: `COMMITTED_IMPLEMENTATION_CANDIDATE / LOCAL_ACCEPTANCE`

Source branch: `feature/v0.2-workbench-core`

Base: `main@e676a545f451f1f4820ceb07cb9fbe3992632a98`

This report records the finite v0.2 milestone defined by
`docs/superpowers/specs/2026-09-11-v02-workbench-core-global-completion.md`.
It does not promote the branch into `main`, publish a release, or expand the
milestone into AADS, RABCL, SEDB-Visual, UI, MOD output, or generation-seed work.

## Accepted product slice

The local candidate implements one connected AI-native visual workbench path:

```text
versioned typed operator
  -> v2 provider capability hard filter
  -> sealed ArtDocument target
  -> source-preserving Sharp/libvips execution
  -> verified content-addressed asset
  -> immutable candidate document graph
  -> independent evaluation/review
  -> append-only promotion or restore event
  -> optional non-owning MRMIC projection
```

The implementation includes:

- a local content-addressed `AssetStore` with byte verification and parent lineage;
- an append-only SQLite `ArtDocumentStore` for projects, documents, versions,
  layers/groups, masks, selections, regions, structure bindings, field bindings,
  evaluations, reviews, current events, projection attempts, and projection outcomes;
- sealed version component graphs with a canonical digest and copy/invalidation policy;
- exact target resolution for document, document version, layer, mask, selection,
  region, structure, and field identities;
- a Workbench execution bridge through the existing dynamic Operator Registry;
- a pinned production `sharp@0.35.4` provider over libvips;
- crop, resize, rotate, mask, alpha, localized edge cleanup, recolor, layered/group
  composite, format conversion, and basic filter operations;
- sidecar, exact-raster, and bounded OpenRaster interchange;
- bounded provider-failure outcomes without automatic retry authority.

## Authority and immutability review

The following adversarial controls are part of acceptance:

| Control | Result |
|---|---|
| Source bytes mutate after intake | CAS bytes remain exact |
| CAS bytes mutate | read and reopen fail closed |
| CAS registration fails after Provider output | no document candidate/current event |
| Receipt identity or output hash lies | rejected before candidate commit |
| Public direct candidate/version/binding append | unavailable; checked graph transaction required |
| Component append after version seal | rejected by API and SQLite trigger |
| Sibling/component graph changes | frozen canonical graph digest is rechecked in commit |
| Spatial transform retains old mask/geometry/field state | all spatial components explicitly invalidated |
| Mask extent differs from raster | Provider fails closed; no implicit mask resize |
| Component-only version promotion or restore | rejected because primary render is stale |
| Current or Canvas revision changes during Provider execution | result cannot create/update current authority |
| Cross-version component target | rejected before Provider access |
| Geometry-only or unresolved region used as pixel mask | rejected before Provider access |
| SQL UPDATE/DELETE/REPLACE | rejected from a fresh default SQLite connection |
| SQL REPLACE through alternate UNIQUE/PK or implicit rowid | rejected by BEFORE INSERT conflict guards |

Provider receipts remain execution evidence only. They do not contain evaluation,
acceptance, review, promotion, or current-version authority.

## Layer and locality review

`LayerGroup` is executable rather than metadata-only. The bridge derives the stack
from the sealed document graph, rejects caller-supplied replacement stacks, resolves
every layer/mask through CAS, and sends the bounded tree to Sharp. Sharp renders nested
groups in order and applies visibility, opacity, blend modes, and masks.

`EDGE_CLEANUP` is regional. A pixel mask is required either through a region/selection
binding or as an exact CAS parameter. Mask dimensions must equal raster dimensions,
and pixels outside the selected mask preserve their original alpha exactly.

## Evaluation, review, and current-version gate

Candidates never become current from Provider output alone. Promotion requires an
accepted durable evaluation and follows the document's configured policy. A
`human_required` document additionally requires an exact approving human review.
Automatic deterministic policy accepts only deterministic or hybrid evaluator
evidence. Every current-pointer change is an append-only event and may target only a
sealed `CURRENT_RENDER` version.

## MRMIC projection classification

MRMIC remains Canvas authority; EveAtelier remains asset/document authority.

The v0.2 test path uses the production `MrmicClient` contract against a deterministic
local protocol witness. It verifies post-transaction readback of:

```text
provider = external
resourceKind = artifact
ownershipTransferred = false
```

Projection records a durable `PREPARED` attempt before dispatch. The local and remote
idempotency keys must be identical. A retained attempt without a terminal outcome is
classified `UNCERTAIN` and suppresses blind retry. Verified, failed, and uncertain
outcomes are stored separately from document/current authority.

This is contract-level local verification. A new live external MRMIC deployment was
not started for this milestone; the repository's opt-in live test remains skipped and
must not be reported as newly measured production evidence.

## Open-source boundary

- Direct production dependency: `sharp@0.35.4`, exact lockfile resolution.
- Observed runtime in this environment: Sharp 0.35.4 and libvips 8.18.6.
- Machine-readable Windows platform package license:
  `Apache-2.0 AND LGPL-3.0-or-later`.
- `npm audit` reported zero known vulnerabilities for the resolved tree.
- No GIMP, Krita, GEGL, ComfyUI, or other upstream source was copied into this core.
- No private fixture image or user-local absolute path is part of the candidate diff.

`THIRD_PARTY_NOTICES.md` records the direct runtime boundary. The repository still has
no selected project license; this candidate does not make a public binary release.

## Validation evidence

Final gates were replayed from a detached clean worktree of the committed candidate:

```text
npm run check
  checked_js=40 checked_python=true

npm ci
  added 5 packages; audited 6 packages; 0 vulnerabilities

node --test tests/art-domain/*.test.js
  25 tests, 25 pass, 0 fail

npm test
  172 tests, 171 pass, 0 fail, 1 explicit opt-in live-MRMIC skip

npm audit --json
  total vulnerabilities = 0
```

## AI participation record

- Local architect/implementer: Codex primary task.
- Governing Twin: one read-only MSSP challenger. Its first review returned CHALLENGE
  with concrete authority, immutability, compositing, locality, and projection
  counterexamples; those counterexamples drove the repairs and regression controls.
  Its final fresh read-only replay returned `MSSP ACCEPT / CONCUR` with behavioral,
  structural, and discriminative closure all `PASS` (25/25 focused tests).
- GLM 5.3 Flash: one code-candidate request was dispatched through MACR. It terminated
  at the provider output limit with no answer or Candidate Vault artifact. No GLM text,
  patch, test, or authority claim was adopted, and it was not retried.

## Non-claims and next authority gate

- `main` is unchanged by this report.
- No merge, release, deployment, or public asset distribution is claimed.
- The private Character Remaster rights-clear gate remains separate and open.
- The Same-Series calibration kernel remains a Phase 7 precursor, not v0.2 authority.
- AADS, RABCL, SEDB-Visual, the human UI, sister-runtime work, and generation-seed
  research remain later milestones.

## Integration supersession

The preceding non-claims record the authority state at acceptance time. On 2026-09-11,
the user separately authorized merge, update, and publication. Local `main` was
fast-forwarded from `e676a545f451f1f4820ceb07cb9fbe3992632a98` to the exact accepted
source commit `bab2a4abf940399d3d5bcdac7c765b856a0a3f42`; the user's untracked research
documents and backup archive remained outside the merge. GitHub `main` publication is
verified separately after the integration documentation commit is pushed.
