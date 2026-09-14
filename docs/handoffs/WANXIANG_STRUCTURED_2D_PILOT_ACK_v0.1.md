# Wanxiang Structured 2D Pilot — ACK Receipt

Request ID: `EA-WX-V06-REQUEST-001`

Date: 2026-09-14

Status: `ACK_RECEIVED / PRIMARY_PROPOSED / USER_ADOPTION_PENDING / EXECUTION_NOT_STARTED`

Recipient task title: `解析万象游戏与工作坊MOD工具`

Claimed author role: `programming`

Relay is authorship: `false`

Reviewed request revision:
`docs/post-v05-dual-surface-roadmap@a1acbf77525900e4921e54996f317d6f50c720bb`

## Receiver response

The game-side task returned `ACK`, confirmed BuildID `25006280`, retained the game
installation as read-only and proposed one primary plus two bounded alternates.

### Primary proposal

| Field | Value |
|---|---|
| logical identity | Hero `1001` |
| name | 萬輕舟 |
| title | 南天玉柱 |
| variant | 1/2 |
| source evidence claim | `resources.assets` Sprite pathID `2637`, `EXACT_CONTAINER_PATH` |
| SHA-256 | `41DC532E38374E3F5C2215F9C9789A1F2AF3C9C772DF0A6AC842383D4401F248` |
| decoded raster | PNG RGBA, 1280×1280, alpha [0,255] |
| observed-use claim | Hero.Image 1; EventDialog.Image 291 |
| MOD evidence claim | bundled local example replaces the corresponding dialogue portrait with a raw RGBA PNG |

The game-side task recommends `1001` because the existing private Character Remaster
pack and exact MOD-path example make it the smallest first integration target.

### Alternate proposal 1

| Field | Value |
|---|---|
| logical identity | Hero `3027` |
| name | 夏侯珺 |
| title | 金錢雁 |
| variant | 0/5 |
| source evidence claim | `resources.assets` Sprite pathID `3738`, `EXACT_CONTAINER_PATH` |
| SHA-256 | `3077379346BA795FD553EE90E1043EE26365536350CD469596694E1897AD16DB` |
| decoded raster | PNG RGBA, 1280×1280, alpha [0,255] |
| observed-use claim | Hero.Image 1; EventDialog.Image 103 |
| experiment role | complex costume, sword, ornament and hair isolation stress case |

### Alternate proposal 2

| Field | Value |
|---|---|
| logical identity | Hero `6020` |
| name | 左靈珠 |
| title | 七巧連環 |
| variant | 0/3 |
| source evidence claim | `resources.assets` Sprite pathID `4753`, `EXACT_CONTAINER_PATH` |
| SHA-256 | `38E36C14E14616D072CC5A1933954C130608EE5B7B10F8BDF4E24583E39645CC` |
| decoded raster | PNG RGBA, 1280×1280, alpha [0,255] |
| observed-use claim | Hero.Image 1; EventDialog.Image 62; EventSelection.Image 15 |
| experiment role | simpler silhouette/material decomposition control |

## Independent receiver-side verification

The EveAtelier task independently read the three candidate PNG files from the private
research copy and reproduced:

- all three SHA-256 values exactly;
- PNG format;
- 1280×1280 dimensions;
- sRGB, four channels and explicit alpha;
- alpha extrema [0,255].

The Sprite pathIDs, pivot/PPU/border metadata, table-use counts and bundled MOD-example
semantics remain game-side ACK evidence; they were not independently rederived in this
receipt.

## MOD consumption status

- Hero `1001`: static asset-class/path evidence exists through the bundled local MOD
  example.
- Hero `3027` and `6020`: same-slot consumption is inferred from the shared
  `Roles/Image/<id>` convention and remains unverified by an individual package/run.
- A dedicated image importer was not established; the observed ModTools are primarily
  Excel/data conversion tools.

Therefore the pilot may prepare a PNG overlay candidate, but official-tool and live-game
acceptance remain `NOT_MEASURED`.

## Retained NOT_MEASURED

- dialogue UI transform, displayed scale, crop/safe frame and Canvas placement;
- whether raw MOD PNG loading preserves source pivot/PPU import settings;
- individual 3027/6020 package/load behavior;
- live game consumption, visual quality, performance and save compatibility;
- structured decomposition, recomposition, layer leakage and protected drift;
- human art acceptance and game/MOD acceptance.

## Authority and rights

- private local experiment authorization remains in force;
- `RIGHTS_CLEAR_REAL=false`;
- game-original research copies and generated derivatives do not enter Git or public
  distribution;
- two negative references remain unordered;
- “清涼服裝” remains excluded without becoming a generalized costume/exposure rule;
- ACK and primary recommendation do not adopt the roadmap or start a Provider;
- decomposition, attractive rendering and PNG export do not imply game import or MOD
  acceptance;
- installed-game mutation requires a later exact user-authorized action.

## Next decision

Game-side evidence supports Hero `1001` as the primary v0.6 private pilot and Heroes
`3027` / `6020` as bounded stress/control alternates. The selection remains a proposal
until the user adopts the roadmap and authorizes the v0.6 implementation/pilot gate.
