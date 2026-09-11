# Visual Intelligence fixtures

These public synthetic fixtures exercise the v0.3 AADS/RABCL intake boundary.

- `background-removal-intent.example.json` is a human-authored, provider-neutral
  natural-language intent. It contains no private image bytes or local path.
- `worker-context-profile.example.json` requests a bounded read-only projection from
  Project Context Home. It grants no write-back, evaluation, promotion, merge, release,
  or deployment authority.

The fixtures do not select a model, Provider, workflow backend, or external AI worker.
