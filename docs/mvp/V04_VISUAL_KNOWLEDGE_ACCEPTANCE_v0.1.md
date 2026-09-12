# EveAtelier v0.4 Visual Knowledge Acceptance

Date: 2026-09-12

Status: `COMMITTED_IMPLEMENTATION_CANDIDATE / LOCAL_ACCEPTANCE`

Branch: `feature/v0.4-visual-knowledge`

Base: `main@182f02cdda25729b6466ece1d75d791309469d8d`

Canonical roadmap digest:

```text
DB97375516B42DEBCA5949F974D8D91D20B31F39A76F0CEB262F1F83A64EBF10
```

This report accepts the finite v0.4 SEDB-Visual / Style Atlas candidate. It does not
merge or deploy the branch, store private image bytes, run an external AI worker, or
claim universal aesthetics, autonomous theory evolution, or causal proof.

## Accepted product loop

```text
v0.3 accepted AADS session
  -> exact ArtDocument/receipt/review readback
  -> atomic SEDB-Visual ingestion
  -> append-only global project revision
  -> deterministic Style Atlas
  -> rights-aware persisted RetrievalContext
  -> ConstraintPacket/v2 + ProjectContextSnapshot/v2
  -> new AADS plan bound to retained knowledge
```

This closes the first reusable memory loop. Retrieval is evidence input; it does not
silently alter constraints, choose a Provider, accept a candidate or promote current.

## Canonical SEDB-Visual records

The v0.4 store supports immutable records for:

- `SourceIdentity`;
- `ReferenceAsset`;
- `ReferenceRole`;
- `VisualConcept` and human-only status events;
- `StyleObservation`;
- `PreferenceEvent`;
- `ArtifactEvaluation`;
- `FailureMode`;
- `ProviderCapabilityEvidence`;
- `WorkflowExperience`;
- `SemanticRelation`;
- `VisualFeatureObservation`;
- `VisualRetrievalContext`;
- `StyleAtlasSnapshot`.

Every canonical record append produces one ledger event bound to record kind, ID,
project, canonical digest and time. Atlas and retrieval records are persisted but do
not advance canonical knowledge revision because they are derived projections.

## Authority partition

```text
AssetStore            = image-byte authority
ArtDocumentStore      = document/version/current authority
OperatorRegistry      = Operator meaning/version authority
VisualIntelligence    = session/workflow authority
SEDB-Visual           = scoped semantic/evidence authority
Style Atlas           = rebuildable discovery projection
Human preference      = project-local observer evidence
```

No SEDB or Atlas method can mutate artwork current, activate an Operator, fill a human
review, merge a branch, publish a release or deploy a runtime.

## Rights and asset closure

SEDB stores verified `AssetRef` values only; schema inspection confirms no BLOB or
image-byte column. Reference and evaluation reads re-verify the retained CAS bytes.

Rights classes remain:

```text
RIGHTS_CLEAR
PRIVATE_RESEARCH
UNKNOWN
```

`RIGHTS_CLEAR` requires `RIGHTS_CLEAR_REAL` evidence and human/import provenance.
Completed-session ingestion requires an explicit human rights-classification actor and
forbids derived assets from changing the source rights class. Human liking, evaluation
acceptance and workflow success cannot upgrade private research rights.

Every retrieval query includes an exact `allowedRightsClasses` list. That filter also
applies to dependent style observations, preferences and failure evidence, not only the
top-level reference card. A private explicit reference adds a `LOCAL_ONLY_REFERENCE`
hard constraint; both Controller and VisualIntelligenceStore reject non-local policy.

## Reference roles

The store supports style core, identity, face, proportion, pose, costume, color, line,
lighting, composition and multiple negative roles.

Every binding has an influence-dimension allowlist. Style, line, color, lighting,
proportion, pose and composition roles cannot influence identity dimensions. A
negative role may explicitly inspect a face/identity dimension only as an avoidance
constraint.

The reference-intent adapter demonstrates the explicit instruction:

```text
use A's line
use B's color
use C's light
avoid D's face
```

It resolves retained role IDs; it does not infer roles from filenames or pixels.

## Evidence separation

- AI-authored VisualConcept definitions always start `CANDIDATE`.
- Only exact human status events can move a concept through
  `CANDIDATE -> PROVISIONAL -> ACTIVE -> DEPRECATED`.
- Style observations preserve evaluator and model/Provider conditioning metadata.
- Preference events require a human observer and `PROJECT_LOCAL` scope; universal or
  objective claims are rejected.
- Artifact evaluations must byte-semantically preserve the original ArtDocument
  version, asset, verdict, evaluator, measurements and evidence references.
- Provider evidence is bound to an exact retained Workbench execution and project.
- Accepted and stopped/uncertain workflow experiences remain distinct.
- `OBSERVER_PROJECTION` relations require an observer. Other relation layers forbid one.

## Ledger and atomicity closure

The ledger verifier reconstructs all canonical and derived records, validates retained
schemas, replays concept status transitions, recomputes every record digest, verifies
one-to-one record/ledger cardinality and derives the exact project revision.

Fresh-connection controls reject UPDATE, DELETE, alternate-UNIQUE REPLACE and implicit
rowid REPLACE with `recursive_triggers=0`. A valid-shaped direct SQL record without its
ledger event is detected as an orphan/count mismatch.

Completed-session ingestion uses one outer SQLite transaction. A waiting session,
rights escalation or late invalid role leaves no SourceIdentity, reference or ledger
fragment behind.

## Style Atlas closure

The Atlas deterministically rebuilds:

- four reference cards in the primary fixture, including a private control;
- all explicit role masks;
- active concepts linked by semantic relation;
- accepted/rejected evaluation summaries;
- human project favorite score;
- two separate negative references without a primary;
- feature clusters isolated by extractor ID/version/space/dimensions.

Synthetic cosine controls produce similarity `0.8` in one extractor space. A second
extractor observation remains a separate singleton cluster and never contaminates the
first space.

Recorded Atlas content is independently rebuilt inside the store. Altering a card,
score, cluster, source digest or knowledge revision is rejected.

## Retrieval closure

Retrieval combines bounded lexical tokens, requested roles/dimensions, rights class,
accepted evaluations, project preference, active concepts, failure modes, historical
Provider evidence, workflow experience and semantic relations.

Each selected ID has one score and non-empty reasons. Dependent records may be selected
only when their required reference card is also selected, preventing orphan evaluation
or preference context under small result limits.

The retained background-removal query returns exact IDs for:

- accepted and explicit negative references;
- active fine-line concept;
- style observation;
- original ArtifactEvaluation;
- human preference;
- visible-white-fringe failure mode;
- three Workbench Provider executions;
- accepted AADS workflow experience;
- semantic relations.

Changing a selected ID/score/reason, Atlas digest or knowledge revision is rejected by
an independent deterministic rebuild.

## AADS v2 integration

`ConstraintPacket/v1` and `ProjectContextSnapshot/v1` remain backward-compatible.
When retrieval is supplied, the Controller emits v2 records with exact
`retrievalContextRefs` and a non-null SEDB authority label before planning.

VisualIntelligenceStore independently resolves each retrieval ID through the injected
knowledge store and checks project scope and rights/privacy compatibility. Packet and
context retrieval lists must match exactly.

Project Context Home exposes only retrieval IDs through the allowlisted `RETRIEVAL`
section. Worker projections do not inline full SEDB evidence and retain all v0.3
no-write/no-evaluate/no-promote/no-merge/no-release/no-deploy flags.

Both VisualIntelligenceStore and VisualKnowledgeStore are closed and reopened in the
primary control using late binding to resolve their mutual runtime boundary. The same
packet, context, session status, retrieval, Atlas and ledger revision are reconstructed.

## Validation evidence

Final detached clean-worktree gates:

```text
npm ci
  completed; 0 vulnerabilities

npm run check
  checked_js=55 checked_python=true

node --test tests/visual-knowledge/*.test.js
  15 tests, 15 pass, 0 fail

npm test
  211 tests, 210 pass, 0 fail, 1 explicit opt-in live-MRMIC skip

npm audit --json
  total vulnerabilities = 0
```

These counts were reproduced from a detached clean worktree after `npm ci`. They
accept the committed v0.4 feature candidate only; they do not claim main integration.

## AI participation

This milestone was implemented and reviewed inline by the primary Codex task. Per the
user's continuing instruction, GLM and MACR were not called. No child AI or external
worker authored code, saw the Project Context Home, validated the result or gained
repository authority.

## Non-claims

- v0.4 is not merged or deployed by this report.
- No image bytes are stored in SEDB-Visual.
- No vector database, embedding service, external model or network retrieval is used.
- Similarity, clustering and ranking are derived discovery aids, not truth.
- One observation or persistent correlation is not causal proof.
- AI proposals do not autonomously evolve or activate visual theory.
- Historical Provider success is not current availability or future-selection authority.
- Project preference is not universal aesthetics.
- Retrieval does not yet rewrite constraints or choose Providers automatically.
- Generation-seed integration, v0.5 UI and strict rights-clear Real MVP remain separate.
