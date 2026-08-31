# Same-Series experimental contract fixtures

This directory contains public-safe examples for the schema-first style-control
foundation. The examples contain synthetic artifact identities and no image bytes,
private filesystem paths, provider prompts, model parameters, or acceptance claims.

The current contracts deliberately stop at `EXPERIMENTAL_UNCALIBRATED`:

- `StyleConstraintPacket` preserves five control layers, constraint strengths, and
  explicit reference influence masks. Layer controls come from a closed provider-neutral
  registry; provider execution knobs are rejected. Provider compilers remain downstream.
- `SameSeriesObservation` records six separate dimensions plus artifact and evaluator
  provenance. A scalar style score is not a substitute.
- `HumanPairwisePreference` is project-local evidence bound to both artifact IDs and
  SHA-256 byte identities. Its scope must match the observation. It is stored alongside,
  not inside, the observation decision and cannot promote an artifact.
- Every structurally valid observation currently classifies as `UNVERIFIED` with
  `same_series_thresholds_not_calibrated`.

Private benchmark images and path-bearing manifests belong under the Git-ignored
`artifacts/runtime/style-control/` tree. Do not copy the private 1086 source or its
derived PNG files into this tracked fixture directory.
