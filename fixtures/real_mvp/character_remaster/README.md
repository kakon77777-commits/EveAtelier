# Character Remaster local fixture pack

Place rights-clear local source and reference images in `source/` and `reference/`.
Those image directories ignore their contents by default; only the ignore rules are tracked.

Copy `intent/task_001.example.json` and `expected/task_001_thresholds.example.json`
to local runtime files before a real run. The example thresholds are deliberately marked
`EXAMPLE_UNCALIBRATED` and cannot produce Real MVP acceptance.

Required reference roles are:

- `line_reference`
- `color_reference`
- `negative_reference`

Optional roles are `quality_reference` and `identity_reference`.
