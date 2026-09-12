# EveAtelier v0.4 Visual Knowledge — Global Completion Contract

Date: 2026-09-12

Status: `ARCHITECTURE_BASELINE / COMMITTED_IMPLEMENTATION_CANDIDATE / LOCAL_ACCEPTANCE`

Baseline: `main@182f02cdda25729b6466ece1d75d791309469d8d`

Canonical roadmap source observed locally:

```text
EveAtelier_Post_Basic_MVP_Remaining_Implementation_Roadmap_v0.1.md
SHA-256 DB97375516B42DEBCA5949F974D8D91D20B31F39A76F0CEB262F1F83A64EBF10
```

Research inputs were read as non-authoritative data. Their relevant retained
distinctions are:

```text
shared relation != shared subjective experience
human preference != universal aesthetic truth
observation != causal proof
operator proposal != operator promotion
visual edit authority != theory mutation authority
dynamic != arbitrary
```

## 1. Product target

This milestone completes the roadmap's bounded v0.4 Visual Knowledge slice:

```text
verified Asset / ArtDocument / AADS evidence
  -> append-only SEDB-Visual semantic records
  -> rebuildable Style Atlas discovery projection
  -> persisted query/retrieval context
  -> digest-bound AADS planning input
```

It turns past accepted and rejected work into project-local retrieval evidence without
storing image bytes or allowing the knowledge plane to overwrite current artwork,
promote Operators, or declare aesthetic truth.

## 2. Authority partition

```text
AssetStore = binary authority
ArtDocumentStore = artwork/version/current authority
OperatorRegistry = operator meaning/version authority
VisualIntelligenceStore = AADS/RABCL session authority
SEDB-Visual = project-local semantic/evidence authority
StyleAtlas = derived discovery projection
Human review = project preference evidence, not universal truth
```

No knowledge record may directly mutate any other authority. An accepted evaluation
may be indexed; indexing does not re-perform or strengthen the acceptance.

## 3. Minimum SEDB-Visual records

The append-only store must support immutable, strictly typed records for:

```text
SourceIdentity
ReferenceAsset
ReferenceRole
VisualConcept
VisualConceptStatusEvent
StyleObservation
PreferenceEvent
ArtifactEvaluation
FailureMode
ProviderCapabilityEvidence
WorkflowExperience
SemanticRelation
VisualFeatureObservation
VisualRetrievalContext
StyleAtlasSnapshot
```

All records carry project scope, exact source/subject identities, evidence class,
provenance, evidence references and canonical time. Unknown remains first-class.

## 4. Binary and rights boundary

SEDB-Visual stores only `AssetRef` identities and verified metadata. Asset bytes remain
in AssetStore. Every referenced asset is verified at append and retrieval time.

`rightsClass` remains one of:

```text
RIGHTS_CLEAR
PRIVATE_RESEARCH
UNKNOWN
```

User authorization for a private experiment does not upgrade `PRIVATE_RESEARCH` or
`UNKNOWN` to public redistribution evidence.

## 5. Reference roles

The first role vocabulary is:

```text
STYLE_CORE_REFERENCE
IDENTITY_REFERENCE
FACE_REFERENCE
PROPORTION_REFERENCE
POSE_REFERENCE
COSTUME_REFERENCE
COLOR_REFERENCE
LINE_REFERENCE
LIGHTING_REFERENCE
COMPOSITION_REFERENCE
NEGATIVE_REFERENCE
```

Each binding carries an explicit influence-dimension allowlist. Style/color/line/
lighting/composition references cannot silently influence face, gender, character or
costume identity. Negative references remain multiple first-class records; no fake
primary is selected.

## 6. Concepts and theory mutation

Visual concepts are immutable versioned definitions. Initial state is `CANDIDATE`.
Only append-only, exact human-authored status events may move:

```text
CANDIDATE -> PROVISIONAL -> ACTIVE -> DEPRECATED
```

AI/system/runtime provenance may append observations and proposals but cannot activate,
merge, split, deprecate or otherwise mutate canonical concept status.

## 7. Evidence separation

### StyleObservation

Records multidimensional same-series observations with evaluator identity,
conditioning context, limitations and evidence maturity. Model-conditioned evidence is
allowed as evidence metadata but never becomes an Operator parameter.

### PreferenceEvent

Records one observer's project-local LIKE, DISLIKE or pairwise/TIE judgment. It may
influence project retrieval but cannot state universal, objective or all-user quality.

### ArtifactEvaluation

Imports an exact existing ArtDocument evaluation by ID/version/asset. It preserves the
original verdict and evaluator; SEDB-Visual cannot reclassify it.

### ProviderCapabilityEvidence

Records an observed Provider/operator outcome, evidence class, context tags and
bounded quality signals. It is historical evidence, not current availability.

### WorkflowExperience

Records exact AADS session/workflow/operator/evaluation/preference/failure references
and consumed budget. It cannot authorize a retry or future promotion.

### SemanticRelation

Separates relation layers:

```text
ARTIFACT
PERCEPTUAL
SHARED_DOMAIN
OBSERVER_PROJECTION
```

Only `OBSERVER_PROJECTION` may carry an observer identity; it may not be queried as a
shared-domain fact without the observer condition.

## 8. Global revision and replay

Every canonical append also writes one global project ledger event containing record
kind, record ID and canonical record digest. The project knowledge revision is the
latest ledger sequence. UPDATE, DELETE, REPLACE, alternate UNIQUE and implicit rowid
attacks fail from a fresh SQLite connection.

Close/reopen must preserve every record, status derivation, ledger digest and project
revision. Ledger history is never erased by deprecation.

## 9. Style Atlas

Style Atlas is rebuilt from a bound knowledge revision and source-record digest. It
provides:

- reference cards;
- exact roles and influence masks;
- active visual concepts;
- accepted/rejected evaluation summaries;
- human project favorites and dislikes;
- multiple negative references;
- deterministic lexical search;
- deterministic cosine similarity over explicit feature observations;
- deterministic clusters only among the same extractor/version/vector space.

Clusters, rankings and favorite scores are discovery aids. They do not write back to
canonical records. A recorded Atlas snapshot must byte-semantically match a fresh
rebuild from its declared knowledge revision.

## 10. Retrieval context

A query declares task type, semantic dimensions, desired reference roles, bounded text
and limit. The Atlas selects exact record IDs with scores and reasons. Selection is
persisted as `VisualRetrievalContext` bound to:

- project ID;
- query;
- project knowledge revision;
- Atlas source digest;
- selected canonical record IDs;
- per-selection evidence.

Stale or fabricated selected IDs, scores, source digests or revisions fail before
append. Repeating a query at the same revision is deterministic. A later revision
creates a new context rather than mutating the old one.

## 11. AADS integration

Before constraint compilation/planning, v0.4 AADS may receive exact retrieval-context
IDs from SEDB-Visual. `ConstraintPacket/v2` and `ProjectContextSnapshot/v2` bind these
IDs explicitly. The VisualIntelligenceStore verifies their project scope and retained
identity through an injected knowledge-store boundary.

Project Context Home may expose only the retrieval IDs in its `RETRIEVAL` allowlisted
worker section. It does not inline private bytes or silently copy all knowledge.

No retrieval result directly changes hard constraints, Operator selection, evaluation
or promotion. Such policy use requires an explicit later compiler rule.

## 12. Completed-session ingestion

The v0.4 ingestor accepts only a terminal `COMPLETED/ACCEPTED` AADS session. It reads
exact retained ArtDocument evaluations/reviews/receipts and emits:

- derived source/reference identity for the promoted asset;
- preserved ArtifactEvaluation;
- project-local human preference when a human review exists;
- ProviderCapabilityEvidence for each completed operator execution;
- WorkflowExperience bound to the exact session digest and budget use;
- semantic lineage relation from source version to accepted reference.

Ingestion is idempotent and atomic. A stopped, failed, waiting, stale, unpromoted or
cross-project session creates no knowledge records.

## 13. Reference-driven intent

The public helper can bind explicit human directives such as:

```text
A's line
B's color
C's light
avoid D's face
```

to exact ReferenceRole records and v0.3 VisualIntent references. It does not guess
roles from filenames or image appearance. Negative identity influence remains explicit.

## 14. Primary acceptance path

1. Run the v0.3 synthetic background-removal session through human-approved promotion.
2. Ingest the completed session atomically into SEDB-Visual.
3. Register additional explicit positive and negative reference roles plus feature
   observations.
4. Build and persist a Style Atlas snapshot.
5. Verify lexical search, negative-reference retention, project favorite ranking,
   vector similarity and extractor-isolated clustering.
6. Build and persist a background-removal RetrievalContext.
7. Start a new AADS session whose v2 constraint/context records bind that retrieval ID
   before planning.
8. Close/reopen all knowledge/intelligence stores and reconstruct the same records,
   revision, Atlas digest and retrieval binding.

## 15. Required falsifying controls

- an AssetRef whose bytes or index identity is missing/tampered is rejected;
- private rights are not promoted by preference or acceptance;
- style roles cannot enable identity dimensions;
- AI cannot activate/deprecate a VisualConcept;
- preference scope cannot be universal/cross-project;
- ArtifactEvaluation cannot change the source verdict/version/asset;
- observer projection cannot masquerade as shared-domain relation;
- feature vectors with wrong norm/dimension/extractor binding fail;
- clusters never mix extractor spaces;
- Atlas snapshot forgery or stale revision fails;
- retrieval selected IDs/revision/digest/score forgery fails;
- stopped/unpromoted/cross-project session ingestion is atomic and empty;
- AADS retrieval binding without the injected knowledge store fails;
- worker projection cannot expose non-allowlisted full knowledge or write-back;
- direct SQL mutation/replace attacks fail;
- existing v0.1-v0.3 tests remain green.

## 16. Explicitly deferred

- vector database dependency or network embedding service;
- autonomous ontology/operator evolution;
- causal claims from correlation or single observations;
- universal aesthetic ranking;
- cross-user preference merging;
- image-byte storage in SEDB;
- automatic Provider choice or promotion from historical evidence;
- live external AI workers or worker write-back;
- generation-seed library integration;
- v0.5 human UI;
- hosted runtime, release, deployment or public private-asset distribution.

## 17. Completion definition

v0.4 is locally complete only when:

1. all minimum records and the global revision ledger exist;
2. Style Atlas is deterministic, derived and independently rebuildable;
3. completed-session ingestion reaches persisted knowledge atomically;
4. persisted retrieval binds into v0.3 AADS before planning;
5. reference-driven role masks remain identity-safe;
6. focused and full-suite clean-checkout validation pass;
7. no critical in-scope obligation remains unresolved.

Merge, publication and deployment remain separate authority gates.

## 18. Implemented bindings and evidence

The implementation binds this contract to:

```text
src/visual-knowledge/contracts.js
src/visual-knowledge/store.js
src/visual-knowledge/style-atlas-core.js
src/visual-knowledge/style-atlas.js
src/visual-knowledge/session-ingestor.js
src/visual-knowledge/reference-intent.js
src/visual-intelligence/contracts.js          (v2-compatible extension)
src/visual-intelligence/constraint-compiler.js
src/visual-intelligence/context-home.js
src/visual-intelligence/controller.js
src/visual-intelligence/session-store.js
fixtures/visual_knowledge/
tests/visual-knowledge/
```

The detailed authority, rights, ledger, Atlas, retrieval, ingestion, AADS integration
and non-claim evidence is recorded in:

```text
docs/mvp/V04_VISUAL_KNOWLEDGE_ACCEPTANCE_v0.1.md
```

Final detached clean-worktree evidence on 2026-09-12:

```text
npm ci: completed; 0 vulnerabilities
npm run check: checked_js=55 checked_python=true
focused Visual Knowledge suite: 15/15 pass
full repository suite: 210 pass, 0 fail, 1 explicit live-MRMIC skip (211 total)
npm audit: 0 vulnerabilities
```

These are local candidate results. They do not authorize merge, publication,
deployment, external-worker access, theory promotion or private-asset distribution.
