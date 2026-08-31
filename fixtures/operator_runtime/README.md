# Dynamic Operator Registry Kernel fixtures

These tracked fixtures are synthetic and public-safe. They demonstrate that the Phase 2A
kernel can load a new semantic axis, preservation lock, semantic operator family, executable
operator family, compiler rule, and provider capability manifest from data.

The fixture pack is a definition snapshot, not an activated registry record. Registration
starts at `DRAFT`; append-only lifecycle evidence is required before it can become
`EXPERIMENTAL_UNCALIBRATED`, `CALIBRATED`, or `ACTIVE`.

Important boundaries:

- semantic operators compile to provider-neutral plans;
- uncalibrated packs cannot execute;
- provider-specific execution settings remain inside adapters;
- provider-bound execution requires revision evidence and a fresh output path;
- provider receipts expose logical artifact IDs/hashes, not filesystem paths;
- receipt metadata is checked against the operator pack's exact metadata schema;
- execution attempts retain append-only PREPARED plus COMPLETED or FAILED evidence;
- external proposals cannot self-label as runtime evidence; terminal runtime evidence requires a
  store-issued token bound to the prepared invocation and selected capability manifest;
- provider receipts do not create visual acceptance or Workbench promotion;
- SQLite stores metadata and evidence only, never image bytes or credentials;
- all artifact IDs and semantic concepts in these examples are synthetic.

## Phase 2B VUSD counterfactual fixture

`vusd-counterfactual.example.json` adds one fully synthetic evidence chain:

```text
pre-registered prediction
→ later generated-variant observation
→ explicit collateral delta
→ candidate-only composite operator proposal
```

The prediction and observation are separate immutable records. Their comparison is a derived
residual projection and cannot rewrite either record. A proposal must cite an existing observed
residual, but it does not register a pack, create a lifecycle event, activate an operator, or
grant promotion authority.

The fixture deliberately contains no private VUSD image names, hashes, paths, provider settings,
or claims that the synthetic evidence is calibrated or real-image evidence. `UNKNOWN` remains a
valid semantic delta state; unpredicted observed axes must be recorded as collateral rather than
silently folded into the predicted result.
