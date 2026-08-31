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

## Localized repair

`provider/comfyui-sd15-localized-inpaint-api.json` is the tracked core-node
workflow for a bounded repair of an already accepted/current candidate. It:

- loads an explicit grayscale mask;
- encodes the unchanged parent image;
- limits sampler noise with `SetLatentNoiseMask`;
- composites the decoded repair over the parent with the same mask;
- keeps mask upload, model, seed, parameter digest, parent version, and lineage evidence.

The external run config adds a `localizedRepair` object containing a task ID,
2-4 candidate seeds, intent/negative prompt, normalized mask regions, and
strict locality thresholds. A complete sanitized provider/binding fragment is
tracked at `expected/localized_repair.example.json`. Run it against a persisted
promoted Workbench state:

```text
npm run real-mvp:run -- localized-repair-generate-evaluate --config <config.json> --state <promoted-state.json>
```

The stage writes a repair mask, two or more candidates, resumable Workbench
state, sanitized evidence, and a human-review template. It never promotes.
Acceptance requires the ordinary identity/style/reference evaluator plus
same dimensions, bounded mask coverage, a non-zero masked effect, and zero
changed pixels outside the mask.

The command refuses to reuse an existing output directory. An interrupted
batch remains evidence and must be continued under a new task/runtime directory;
fixed filenames are never overwritten by an automatic retry.
