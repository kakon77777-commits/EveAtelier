# Same-Series Calibration Foundation v0.1

日期：2026-08-31

狀態：`IMPLEMENTED_EXPERIMENTAL / UNCALIBRATED / FAIL_CLOSED`

## 目的

這個 slice 把「看起來像同一系列」從單一 `styleScore` 拆成可保存、可反駁、
可逐步校準的工程 evidence。研究 intake 是需求與假說來源，不是執行指令；本文件只記錄
目前實際落地的 bounded contract。

## 已實作契約

### StyleConstraintPacket

- 保存五層控制：surface rendering、proportion syntax、garment volume、
  composition rhythm、palette compatibility。
- 保存 hard / strong / medium / soft constraints。
- 每個 style reference 必須有 byte hash 與明確 influence mask。
- style reference 對 `faceIdentity`、`gender`、`characterIdentity`、
  `costumeIdentity` 必須明確為 `false`，否則拒絕編譯。
- layer、constraint、reference 與 influence mask 採 exact-field validation；未知的
  provider/workflow/path/outcome/identity 欄位不會被 passthrough。
- 每一層的 `initialControl` 名稱來自封閉的 provider-neutral registry；`denoise`、
  `cfgScale`、`seed`、`loraWeight` 等執行參數不能偽裝成 style control。
- packet 不含 prompt、ControlNet、LoRA 或 provider parameters；這些仍由後續
  provider compiler 決定。

### SameSeriesObservation

每份 observation 必須分開記錄六維：

1. `surfaceRendering`
2. `proportionSyntax`
3. `garmentVolume`
4. `compositionRhythm`
5. `detailLanguage`
6. `paletteCompatibility`

每一維都有 status、confidence、evidence references，整份 observation 另需 source、
candidate、references 的 logical ID / SHA-256，以及 evaluator ID、version、measurement、
limits。缺維度、越界 confidence、缺 evaluator provenance、額外 scalar `styleScore`，
或直接宣稱 `CALIBRATED` 都會 fail closed。Observation、artifact、scope、evaluator 與
dimension 也採 exact-field validation，不能夾帶 private path、provider parameters、
acceptance 或 promotion 欄位。

目前唯一允許的 calibration state 是：

```text
EXPERIMENTAL_UNCALIBRATED
```

因此結構完整的 observation 也只能得到：

```text
UNVERIFIED / same_series_thresholds_not_calibrated
```

### HumanPairwisePreference

偏好 evidence 必須綁定 `PROJECT_LOCAL` project/task scope、兩個不同 artifact 的 logical ID
與 SHA-256、選擇、理由與時間。組裝 review 時，scope 與 candidate bytes 都必須和
SameSeriesObservation 相符。偏好與 observation decision 分開保存，不會產生 acceptance
或 promotion；任何 universal scope claim 都會被拒絕。

## 1086 私人 benchmark intake

已在 Git-ignored runtime 建立 path-bearing metadata，並逐檔重算 source、兩張衍生圖與
目前 Repair A anchor 的 SHA-256；四組皆相符。圖片 bytes 沒有加入 tracked fixtures，
Reflexive Visual Generation 本機 intake 目錄也有精確 ignore rule，避免被廣域 staging。

使用者的偏好原句只足以表達「目前 EveAtelier 方向優於兩張 1086 衍生圖所代表的比較
集合」。它沒有排序兩張衍生圖，而且 Repair A 與 1086 不是同一來源角色。因此該紀錄
保存為 project-direction-over-reference-set observation，不偽造成 pairwise calibration row。

## 驗證結果

```text
npm run check
checked_js=22 checked_python=true

npm test
95 tests / 94 pass / 0 fail / 1 explicit live-MRMIC opt-in skip
```

## 非主張

- 沒有新的生成模型或 evaluator model。
- 沒有 RVGR L1、sampling checkpoint 或 latent rewrite。
- 沒有完成 same-series threshold calibration。
- 沒有因人類偏好而自動接受、promotion 或改寫 Workbench current。
- 沒有把 1086 或其衍生 PNG 視為 rights-clear / game-ready / public-distributable。

## 下一個校準 gate

需要同角色 exact pairs、跨角色 counterexamples、重複且可記錄 disagreement 的 human
pairwise rounds、六維 evaluator provenance、false-positive / metric-blindness 記錄，才可
提出 threshold candidate。threshold candidate 仍需獨立 review，不能由 observer 自我授權。
