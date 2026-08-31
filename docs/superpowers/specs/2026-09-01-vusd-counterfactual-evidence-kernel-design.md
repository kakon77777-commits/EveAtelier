# VUSD Counterfactual Evidence Kernel Design

日期：2026-09-01

狀態：`IMPLEMENTED_CANDIDATE / VERIFIED_LOCAL / PHASE_2B`

## 1. 目標

Phase 2B 將 VUSD 最小可執行證據鏈接到既有 Dynamic Operator Registry Kernel：

```text
Counterfactual Prediction
→ later Observation
→ derived Residual Comparison
→ candidate-only Operator Proposal
```

它補足「事前預測與事後觀察不可混寫」以及「persistent residual 可以提出新算子，但不能自行升格」兩個缺口。這個 slice 不建立完整 VTEKR、藝術史資料庫、Observer Registry 或自動學習策略。

## 2. VUSD crosswalk

| VUSD / VTEKR 概念 | Phase 2A/2B 對應 | 本 slice 邊界 |
|---|---|---|
| Artifact | logical artifact ID + SHA-256 | 不保存圖片 bytes 或本機路徑 |
| Visual Decision / Intervention | `operatorRef` + `axisChanges` + `target` | 必須解析到 exact pack snapshot |
| Shared-domain state | pack-defined `semantic.axis.*` | bootstrap axes，不是最終本體 |
| Minimal Causal Closure | `minimalClosureOperatorRefs[]` | 每個 ref 必須存在於 exact pack |
| Preservation constraint | `lockIds[]` | 每個 lock 必須存在於 exact pack |
| Predicted Counterfactual | immutable prediction record | 不能含 observed outcome |
| Observed Counterfactual | later immutable observation record | 必須綁 prediction，時間晚於 prediction |
| Collateral change | `collateralDeltas[]` | 未預測軸不得偽裝成 primary observation |
| Counterfactual residual | deterministic comparison projection | 不寫回、不改 evidence |
| Unknown | delta `direction` / `magnitude = UNKNOWN` | 合法狀態，不視為零或失敗 |
| Operator discovery | candidate-only proposal | 沒有 activation / promotion API |
| Evidence provenance | `evidenceClass + provenance + evidenceRefs` | label 不能越權宣稱更強證據 |
| Scope | `scopeRefs[]` | 保持外部可擴充，不硬編碼 domain enum |
| Alternative explanation | `alternativeRationaleRefs[]` | 保存 reference，不在 kernel 內裁決真理 |
| Counterevidence | `counterevidenceRefs[]` | proposal 必須可保存反例 |
| Operator lifecycle | Phase 2A registry events | proposal 不建立 pack、版本或 lifecycle event |

仍未對應的 VTEKR object families：

- Creator / Intent / Context 的完整 versioned records；
- Observer trajectory 與 Meaning Projection；
- competing Theory Graph；
- concept-version migration；
- cross-domain retrieval；
-自動 revalidation 與 knowledge promotion governance UI。

## 3. Contracts

### 3.1 Prediction

`eve-atelier-visual-counterfactual-prediction/v1` 必須包含：

- exact `packRef` / `operatorRef`；
- before artifact logical ID + SHA-256；
- target、axis intervention、locks 與最小 operator closure；
- predicted shared-domain deltas；
- scope、rationale、alternatives 與 evidence refs；
- evidence class、provenance 與 recorded time。

Prediction schema 不接受 `observedDeltas`、provider binding、acceptance、status 或 promotion 欄位。

### 3.2 Observation

`eve-atelier-visual-counterfactual-observation/v1` 必須包含：

- immutable prediction ID；
- after artifact logical ID + SHA-256；
- observed deltas 與明確 collateral deltas；
- evaluation、limitation 與 evidence refs；
- evidence class、provenance 與 recorded time。

Observation 必須在 prediction 之後追加。其 primary observed axes 必須是 prediction 已預測的 axes；新增影響只能進 `collateralDeltas`，而已預測的 axis 不得被重新標成 collateral。

### 3.3 Operator Proposal

`eve-atelier-operator-proposal/v1` 只是一個 candidate record：

- 綁定 base pack snapshot；
- 引用一個或多個已存在 observation residual；
- 宣告 `COMPOSITE` 或 `PRIMITIVE_CANDIDATE` decomposition；
- 保存 scope、rationale、evidence 與 counterevidence；
- 允許 AI / HUMAN / SYSTEM 提出；
- 不含 status、activation、authority 或 promotion。

`COMPOSITE` 必須引用既有 component operators；`PRIMITIVE_CANDIDATE` 不得偽裝已有 components。
Proposal 必須在它引用的 residual observations 之後追加。
被引用的 observation 必須至少包含一個 `PARTIAL`、`MISMATCH`、`UNRESOLVED` 或 `COLLATERAL`；全數 `MATCH` 的 observation 不能只靠欄位名稱冒充 residual evidence。

## 4. Persistence

Phase 2B 在同一 SQLite registry metadata database 中新增：

```text
counterfactual_predictions
counterfactual_observations
operator_proposals
```

所有表都有：

```text
UPDATE forbidden
DELETE forbidden
INSERT OR REPLACE forbidden
```

VUSD persistence 由內部 `VusdEvidenceStore` 組合到 `OperatorRegistryStore`，避免把 theory-evidence implementation 與既有 pack/runtime execution logic 混成單一大類別。公開 consumer 仍透過 registry 的 bounded facade。

## 5. Residual comparison

Comparison 是純衍生 projection，不成為 evidence source：

| Status | 意義 |
|---|---|
| `MATCH` | direction 與 magnitude 都相同 |
| `PARTIAL` | direction 相同、magnitude 不同 |
| `MISMATCH` | direction 不同 |
| `UNRESOLVED` | prediction/observation 缺失或含 `UNKNOWN` |
| `COLLATERAL` | observation 明確記錄的未預測影響 |

這些 labels 只比較 declared deltas，不宣稱具有普遍心理學或美學真實性。

## 6. Evidence and authority gates

- AI prediction 只能宣稱 `MODEL_INFERENCE`、`FIXTURE` 或 `CONTRACT_TESTED`。
- AI observation 不能自稱 `CONTROLLED_EXPERIMENT`。
- `provenance.kind` 只是 record-declared classification，不是 host-observed speaker identity，也不能證明實際 Human authority；需要 canonical promotion 時仍必須通過既有外部身份／review gate。
- Observation 不能在 prediction 之前或同時建立。
- Pack、axis、lock、operator、closure component 與 residual refs 全部 exact-resolve，否則 fail closed。
- Operator proposal 不修改 pack，也不建立 lifecycle transition。
- Existing Phase 2A HUMAN calibration / activation gate 保持唯一有效。
- Comparison output 不是 evaluation、acceptance、promotion 或 theory truth。

## 7. Public/private boundary

Tracked fixture `fixtures/operator_runtime/vusd-counterfactual.example.json` 完全使用 synthetic IDs 與 synthetic SHA-256。它不包含：

- VUSD intake 的三張圖片或其檔名；
- 萬象素材；
-私人本機路徑；
- provider/model/prompt parameters；
- rights-clear、calibrated、accepted 或 promoted claims。

私人 EXP-00 / EXP-01 未被搬進 tracked fixture；它們仍只存在於本機 ignored research intake。

## 8. Acceptance criteria

1. Prediction、observation、proposal 使用三個 strict schemas，未知欄位拒絕。
2. Prediction 與 observation 分表且 append-only。
3. Observation 必須引用存在且較早的 prediction。
4. Axis、lock、operator 與 minimal closure 必須由 exact pack snapshot 驗證；closure 必須包含實際 intervention operator。
5. 未預測影響只能進 collateral。
6. Residual comparison 可區分 match、partial、mismatch、unresolved 與 collateral。
7. Proposal 必須引用已存在 observation residual 與合法 component operators。
8. AI 可以 proposal，但不能從此 API activation 或 promotion。
9. Tracked fixture public-safe，與私人 VUSD 圖片完全解耦。
10. Full regression 保持零 failure；既有 live-MRMIC opt-in skip 不變。

## 9. 非目標與不主張

- 不自動從圖片抽取 shared-domain deltas。
- 不把自然語言論文直接編譯成 canonical operators。
- 不實作自動 operator novelty threshold、merge、fork 或 promotion。
- 不表示 VUSD / VTEKR 已完整採納。
- 不表示 EXP-00 / EXP-01 已跨模型、跨角色或跨文化驗證。
- 不啟動 RVGR L1/L2、SEDB-Visual、ISQL、MRMIC mutation 或生成圖 MOD。
- 不把 synthetic fixture 升格成 real visual evidence。

## 10. Candidate verification

```text
npm run check
checked_js=29 checked_python=true

npm test
128 tests / 127 pass / 0 fail / 1 explicit live-MRMIC opt-in skip

git diff --check
exit 0
```

這些結果建立的是本地 candidate behavioral evidence；尚未等同 merge、release、deployment、VUSD theory acceptance 或 real-image calibration。
