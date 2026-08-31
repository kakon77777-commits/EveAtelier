# Dynamic Operator Registry Kernel Design

日期：2026-08-31

狀態：`IMPLEMENTED_CANDIDATE / RE-REVIEW_PENDING / PHASE_2A`

## 1. 目標

Phase 2A 將目前散落在 scenario 與 provider adapter 中的 operator 概念，收斂成一個可執行、可版本化、可由 evidence 校準的動態 Operator Meta-Runtime。

這個 kernel 必須同時滿足：

- 新的語義軸、preservation lock、operator family 與 variant 可以由資料包加入，不必修改 runtime 核心；
- 已被使用的定義不可原地改寫；修正必須建立新版本；
- AI 可以提出定義與 experience evidence，但不能自行校準、啟用或 promotion；
- canonical operator、provider、provider parameters、execution receipt、evaluation 與 acceptance 仍然彼此分離；
- 至少一個既有 deterministic operator 能經 registry、capability matching 與 provider binding 真正執行；
- 新的 semantic operators 在缺乏 calibration、Region 或 Garment Topology 能力時必須 fail closed。

## 2. 非目標

本 slice 不實作：

- 萬象 MOD 圖像生成或批次替換；
- 新生成模型、LoRA、ControlNet 或 provider API；
- ArtDocument / Layer / SemanticRegion / GarmentTopologyGraph runtime；
- Exposure–Tension UI；
- SEDB-Visual 或 ISQL 的正式 adapter；
- RVGR L1/L2、sampling checkpoint 或 latent rewrite；
- 自動 aesthetic acceptance、Workbench promotion 或 MRMIC mutation；
- 模型權重 fine-tuning。

## 3. 核心不變量

```text
OperatorDefinition != ProviderCapability != Provider Parameters
Execution Receipt != Evaluation != Acceptance != Promotion
AI Proposal != Calibration != Activation
Dynamic Definition != In-place Mutation
Artifact Store != Semantic Registry != Workbench Authority
```

所有執行必須保留 exact `packId + packVersion + packDigest + operatorId + operatorVersion`，使歷史結果可重播與追查。

## 4. 架構

```text
OperatorPack
    │ register (immutable digest)
    ▼
RegistryStore ── append-only LifecycleEvent
    │
    ├── SemanticDirective ── SemanticCompiler ── OperatorPlan
    │
    └── OperatorInvocation ── CapabilityMatcher ── Provider.execute
                                                   │
                                                   ▼
                                            Provider Receipt
                                                   │
                                                   ▼
                                      append-only ExperienceEvent
```

### 4.1 Fixed Kernel

核心程式只知道：

- schema validation；
- canonical digest；
- immutable registration；
- lifecycle transition rules；
- semantic compilation protocol；
- provider capability filtering/ranking；
- append-only evidence storage。

核心不內建「河洛式」、「Exposure」、「Tension」或其他今日理論。這些都由 OperatorPack 定義。

### 4.2 Dynamic Packs

一個 `eve-atelier-operator-pack/v1` 包含：

```text
packId
version
description
axes[]
locks[]
families[].variants[]
compilerRules[]
```

Pack 被註冊後，以 canonical JSON SHA-256 識別。相同 `packId + version`：

- 相同 digest：idempotent；
- 不同 digest：`operator_pack_version_conflict`。

## 5. Dynamic Definition Model

### 5.1 SemanticAxisDefinition

```json
{
  "axisId": "semantic.axis.example.intensity",
  "description": "Example project-local semantic axis.",
  "valueSchema": {
    "kind": "SCALAR",
    "min": 0,
    "max": 1
  }
}
```

`valueSchema.kind` 第一版支援：

- `SCALAR`：有限數值與 min/max；
- `ENUM`：非空、唯一字串集合；
- `VECTOR`：具名維度與共同 min/max。

Axis 名稱由 pack 提供；runtime 不硬編碼 axis ID。

### 5.2 PreservationLockDefinition

```json
{
  "lockId": "semantic.lock.example.identity",
  "description": "Preserve the declared identity axes.",
  "targetAxisIds": ["semantic.axis.example.identity"],
  "strength": "HARD",
  "evidenceRequired": true
}
```

Lock 只能指向同一 pack 中存在的 axes。

### 5.3 OperatorFamily / Variant

Family 定義用途域；Variant 定義實際 typed operator：

```text
operatorId / version
executionMode = COMPILE_ONLY | PROVIDER_BOUND
inputKinds / outputKinds
parameterSchema
receiptMetadataSchema
effects
requiredLockIds
requiredCapabilities
locality
determinism
reversibility
authority
```

`parameterSchema` 是 canonical operator parameter schema，不得包含 provider、workflow、model、prompt 或 backend 欄位。Provider-specific compilation 留在 provider adapter。

`receiptMetadataSchema` 定義可回到 canonical receipt 的 provider-neutral metadata；未知欄位、authority 欄位與 private path 一律拒絕。

`authority` 第一版只允許：

- `CANDIDATE_ONLY`
- `OBSERVATION_ONLY`

Phase 2A 不允許 operator 直接 promotion。

### 5.4 CompilerRule

CompilerRule 將一個 `COMPILE_ONLY` semantic operator 映射到一組既有 operator IDs：

```text
sourceOperatorId
emitsOperatorIds[]
requiredAxisIds[]
requiredLockIds[]
```

它不包含 provider parameters，也不包含任意程式碼或 expression evaluator。第一版只產生 provider-neutral constraints 與 step references。

## 6. Semantic Directive / Plan

`SemanticDirective` 必須綁定：

```text
directiveId
packRef { packId, version, digest }
operatorRef { operatorId, version }
target { kind, id }
expectedRevision
axisChanges[]
locks[]
requestedAt
```

Compiler 必須驗證：

- packRef exact match；
- operator 是 `COMPILE_ONLY`；
- axis change 符合 value schema 與 operator effect；
- required locks 全部存在；
- compiler rule 的 emitted operators 全部存在；
- pack lifecycle 可否編譯／執行。

Lifecycle 對 plan 的影響：

| Registry status | Compile | Plan status | Executable |
|---|---:|---|---:|
| `DRAFT` | no | `BLOCKED` | no |
| `EXPERIMENTAL_UNCALIBRATED` | yes | `UNVERIFIED` | no |
| `CALIBRATED` | yes | `UNVERIFIED` | no |
| `ACTIVE` | yes | `READY` | no — RABCL execution compiler remains absent |
| `DEPRECATED` | no new plan | `BLOCKED` | no |

Phase 2A semantic plan 即使 `READY`，也只表示可交給後續 execution compiler；其 `executable` 仍為 `false`，並保留 `operator_plan_execution_compiler_not_implemented` blocker。它不表示圖像已被執行或接受。

## 7. Lifecycle / Authority

Pack 初始狀態固定為 `DRAFT`。允許的 append-only transitions：

```text
DRAFT -> EXPERIMENTAL_UNCALIBRATED
EXPERIMENTAL_UNCALIBRATED -> CALIBRATED
CALIBRATED -> ACTIVE
DRAFT | EXPERIMENTAL_UNCALIBRATED | CALIBRATED | ACTIVE -> DEPRECATED
```

規則：

- 每個 transition 都必須帶非空 `evidenceRefs`；
- `AI` actor 不能建立任何 lifecycle transition；
- `CALIBRATED` 與 `ACTIVE` 必須由 declared `HUMAN` actor 提交；
- event 只記錄 declared actor，不將 actor label 當成現實身份證明；
- event 不可 update/delete；current status 是 append-only events 的 projection。

## 8. Persistence

Phase 2A 使用 Node 24 內建 `node:sqlite`，不增加 npm database dependency。

SQLite 只承載 metadata 與 evidence：

### `operator_packs`

```text
pack_id + version primary key
digest
definition_json
registered_at
proposer_kind / proposer_id
```

### `registry_events`

```text
event_id primary key
pack_id / version / digest
from_status / to_status
evidence_refs_json
actor_kind / actor_id
created_at
```

### `experience_events`

```text
event_id primary key
pack/operator identity
provider identity (optional)
input/output hashes
outcome
evaluation refs
human preference ref (optional)
evidence class
occurred_at
```

三張表都建立 SQLite trigger，拒絕 `UPDATE`、`DELETE` 與 `INSERT OR REPLACE`。Database handle 不暴露為 public API；圖片 bytes、credentials 與 provider payload 不進資料庫。

## 9. Capability Matching / Execution

`ProviderCapabilityManifest` 宣告：

```text
providerId / providerVersion
availability
privacy
capabilities[]
operators[] { operatorId, versions, evidenceLevel, costRank, latencyRank }
```

Matching：

```text
hard filter:
  exact operator/version
  AVAILABLE
  privacy allowed
  required capabilities

stable rank:
  evidence level
  latency rank
  cost rank
  providerId tie-break
```

`executeInvocation()` 只執行：

- exact ACTIVE pack；
- `PROVIDER_BOUND` operator；
- parameter schema 完整且無未知欄位；
- capability manifest 與 provider object identity 相符。
- caller 提供可驗證、帶 evidence ref 的 revision guard；
- output path 在 dispatch 前不存在。

Runtime 傳給 provider exact operation ID、pack digest、operator version 與 logical artifact IDs；provider result 必須逐項回證並提供與實際 bytes 相符的 output SHA-256。Receipt 只公開 logical artifact ID/hash 與 allowlisted metadata，不公開本機 path。Runtime 先寫 `PREPARED` experience；完成或失敗後再 append `COMPLETED` / `FAILED`，但不做 evaluation、acceptance 或 Workbench promotion。

第一個真實綠色控制使用既有 `PillowRasterProvider` 執行 `visual.op.raster.resize`。

## 10. Learning / Convergence

Phase 2A 的「學習」採 evidence-first、non-parametric 路徑：

1. append execution / evaluation / preference experience；
2. 依 exact operator、pack、provider 與 semantic context 查詢相似案例；
3. 外部 AI 或後續 AADS 產生 calibration proposal；
4. proposal 不能原地改 pack，只能提出新 version；
5. human-reviewed lifecycle event 才能將新 version 升級。

收斂不以「被使用次數」定義，而以未來 benchmark 上：

```text
semantic residual decreases
preserved dimensions remain bounded
human agreement improves
false intervention rate remains bounded
plan replay succeeds
provider/evaluator provenance remains exact
```

Phase 2A 只保存足以支持這些計算的 events，不宣稱已完成學習演算法或 calibration。

## 11. Generation Seed Boundary

Generation Seed 保存可重建生成狀態的資訊。Semantic Transform Seed 未來可保存：

```text
pack/schema version
axis deltas
region references
preservation locks
operator graph hash
evidence references
```

兩者可以互相引用，但不能互相取代：

```text
Generation Seed != Semantic Truth != Acceptance Authority
```

Phase 2A 只保留 pack/digest/plan identity，尚不建立完整 seed registry。

## 12. Error Handling

下列情況必須 fail closed：

- unknown schema field；
- unknown axis/lock/operator；
- same version different digest；
- invalid lifecycle transition；
- SQLite REPLACE / UPDATE / DELETE；
- AI self-activation；
- missing calibration evidence；
- uncalibrated semantic plan execution；
- provider mismatch/unavailable；
- missing/stale revision evidence；
- pre-existing or missing output；
- provider operation/pack/operator-version/output-hash mismatch；
- unknown receipt/metadata authority or private-path fields；
- provider-specific field in canonical pack；
- parameter type/range mismatch；
- stale `expectedRevision`（由未來 Workbench transaction consumer 驗證；Phase 2A 不偽造通過）；
- any request for promotion authority。

## 13. Public / Private Boundary

Tracked fixtures 只能使用 synthetic IDs、hashes 與 provider-neutral examples。私人遊戲素材、1086 圖、生成候選、private paths 與 provider credentials 不進 operator pack 或 SQLite fixture。

## 14. Acceptance Criteria

Phase 2A 完成需同時成立：

1. 新 axis/operator family 可由 JSON pack 動態註冊，無需改 core；
2. exact same pack registration idempotent，same version drift 拒絕；
3. registry/experience tables 無法 update/delete；
4. AI actor 無法 calibration/activation；
5. uncalibrated semantic directive 只產生 `UNVERIFIED` non-executable plan；
6. ACTIVE pack 可產生 exact provider-neutral `READY` plan，但在 RABCL 缺席時仍不可執行；
7. capability matcher 對不符 privacy/version/capability 的 provider fail closed；
8. `visual.op.raster.resize` 經 registry/runtime/Pillow 真實執行並保留 receipt；
9. runtime 不 mutation Workbench、不 promotion、不接觸 MRMIC；
10. ordinary full regression 維持 0 failure，live MRMIC 仍為 explicit opt-in skip。

## 15. 後續銜接

- Phase 3：ArtDocument、SemanticRegion、GarmentTopologyGraph；
- Phase 5：AADS 從 ExperienceStore retrieval 後提出 operator plan；
- Phase 6：RABCL 將 READY plan 編成 provider workflows；
- Phase 7：SEDB-Visual 接管長期 semantic observation/query；
- Phase 8：UI 顯示 axes、locks、candidate compare 與 evidence，不取得 authority。

## 16. Candidate Implementation Evidence

目前 feature branch 已實作：

- exact-field dynamic pack、directive、capability、invocation 與 experience contracts；
- canonical JSON SHA-256 pack identity；
- immutable same-version conflict gate；
- append-only `operator_packs`、`registry_events`、`experience_events` 與 anti-update/delete/replace triggers；
- AI lifecycle transition rejection與 HUMAN calibration/activation gate；
- DRAFT / EXPERIMENTAL_UNCALIBRATED / CALIBRATED / ACTIVE / DEPRECATED plan projection；
- provider capability hard filtering、validated runtime-manifest binding與 stable ranking；
- exact revision、operation、pack、operator-version、artifact identity 與 output-hash attestation；
- path-free receipt projection與 data-defined receipt metadata allowlist；
- append-only PREPARED / COMPLETED / FAILED execution evidence；
- ACTIVE `visual.op.raster.resize` 經 registry 與 Pillow provider 真實執行；
- SHA-bound experience event，且 receipt 無 acceptance / promotion 欄位。

Candidate verification：

```text
npm run check
checked_js=28 checked_python=true

npm test
119 tests / 118 pass / 0 fail / 1 explicit live-MRMIC opt-in skip
```

仍不主張：

- semantic axes 已完成 calibration；
- append-only experience 等於已完成 AI learning policy；
- semantic `READY` plan 已有 RABCL/provider workflow compiler；
- Region、Garment Topology、SEDB、ISQL 或 generation-seed registry 已落地；
- deterministic green control 證明任何生成式美術品質。
