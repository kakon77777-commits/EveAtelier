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
- provider receipts do not create visual acceptance or Workbench promotion;
- SQLite stores metadata and evidence only, never image bytes or credentials;
- all artifact IDs and semantic concepts in these examples are synthetic.
