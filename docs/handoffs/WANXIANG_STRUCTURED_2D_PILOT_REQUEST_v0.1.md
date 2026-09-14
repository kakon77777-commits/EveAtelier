# Wanxiang Structured 2D Pilot — Cross-Conversation Request

Request ID: `EA-WX-V06-REQUEST-001`

Date: 2026-09-14

Status: `REQUEST / DELIVERY_PENDING / ACK_NOT_YET_RECEIVED`

Source role: `art`

Recipient role: `programming`

Integration owner: `art` for EveAtelier contracts; `programming` for game-side evidence

Base revision: `EveAtelier main@118ed586630b98d55f5c09c84e97c57f4a4d37ba`

Relay is authorship: `false`

## Purpose

Prepare the Wanxiang research task as the first private consumer of the proposed
EveAtelier v0.6 Structured 2D Asset path.

This packet communicates a contract and requests game-side facts. It does not authorize
the recipient to edit EveAtelier, modify the installed game, publish assets, write a MOD,
download a model, or declare visual/game acceptance.

## User-authorized scope

The user confirms that real AI-art testing should begin with Wanxiang character art.
The authorization is private/local and does not establish public redistribution rights.

The currently retained Character Remaster source/reference pack may be used as the first
anchor. Another character may be nominated by the user or game-side task with exact
identity and source evidence.

## Requested game-side response

Return a native-task ACK or CHALLENGE containing only the smallest useful projection:

1. candidate character/asset logical identity and BuildID;
2. source SHA-256, dimensions and alpha status;
3. observed game use: portrait, sprite, UI, cut-in or other;
4. expected import slot, scale, pivot and format when known;
5. whether official MOD tooling can consume that asset class;
6. exact evidence for known constraints and `NOT_MEASURED` for unknown runtime behavior;
7. recommendation of one primary pilot and at most two alternates;
8. confirmation that game originals remain read-only.

Private local paths may be returned through the native task only. Do not add them to a
public-safe tracked document.

## EveAtelier-side future output

After v0.6 implementation exists, EveAtelier will produce:

- a source-bound Structured 2D graph candidate whose graph revision names one exact
  ArtDocumentVersion;
- Shape/Line/Mask/Material/Palette/Detail separation where supported;
- deterministic recomposition and graph/recipe digest;
- Provider receipt and limitations;
- reconstruction, layer leakage and protected-drift evidence;
- human review and warnings;
- export candidate with a loss report.

The Wanxiang task then performs separate game/import/MOD validation. It must not treat a
successful decomposition or attractive render as proof that the game consumes it.

## Retained boundaries

- the two negative references remain unordered;
- the unrelated “清涼服裝” workshop image remains excluded;
- exclusion does not create a universal costume/exposure negative rule;
- private approval does not become `RIGHTS_CLEAR_REAL`;
- no asset bytes enter Git;
- no installed-game mutation occurs without a later exact action request;
- game import, MOD packaging and public release are separate gates.

## Roadmap reference

See:
`docs/roadmap/EVEATELIER_POST_V05_DUAL_SURFACE_ROADMAP_v0.1.md`
