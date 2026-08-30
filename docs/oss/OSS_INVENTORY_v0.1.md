# EveAtelier OSS Inventory v0.1

Verified: 2026-08-30 against upstream project pages/repositories.

This inventory records reuse candidates, not blanket approval to copy code. A version listed here is the version/snapshot observed during this audit; pin exact commits before importing source.

| Upstream | Observed version / status | Primary language | Upstream license | Important dependencies / boundary | Step 3 operator coverage | EveAtelier role |
|---|---|---|---|---|---|---|
| `viliusle/miniPaint` | 4.14.3 | JavaScript | MIT | Browser stack; package uses Babel runtime, AlertifyJS, exif-js, file-saver, pica, jQuery, uuid and others | crop, resize, layers, selection, alpha/transparency, basic effects, drawing UX | Selective MIT extraction/reference; not canonical state model |
| `lovell/sharp` | 0.35.3 | JavaScript/TypeScript + native Node-API | Apache-2.0 | Uses libvips; Node-API v9; Node >=20.9 | crop, resize, extract, rotate, composite, alpha, color transforms, format conversion | Primary deterministic raster library |
| `libvips/libvips` | 8.18.4 | C | LGPL-2.1 | GLib plus optional image codecs; used transitively by sharp | high-performance raster processing, tiled/streaming transforms | Indirect library through sharp first; direct integration later only if needed |
| OpenRaster specification | 0.0.6 | Format: ZIP + XML + PNG/SVG | Specification, not a runtime library | `.ora`: zip wrapper, `stack.xml`, raster/vector layer files | layered document interchange | Implement compatible codec; do not copy an editor's implementation |
| `mm2/Little-CMS` | 2.19.1 | C | MIT (core) | ICC color engine; optional FastFloat extension has separate GPL3/commercial terms | color-space conversion, ICC transforms, soft-proof plumbing | Core library candidate; FastFloat plugin excluded from default distribution |
| `mypaint/libmypaint` | 1.6.1 | C | ISC | json-c; optional GLib/GObject introspection; optional GEGL/BABL integration | brush strokes, pressure/speed/tilt dynamics | Later brush provider/library; not needed for first MVP |
| GEGL | documented 0.4.62 release | C | Library LGPLv3+; sample CLI/GUI GPL; operations can carry their own licenses | GLib/GObject/BABL; individual operations expose license metadata | processing graph, blur/color/composite/transform/segmentation/etc. | Initial external provider/reference; library embedding requires per-operation license allowlist |
| GIMP | 3.2.4 | C (plus scripting/plugin ecosystem) | Application core GPLv3+; top-level license says libgimp/other libraries LGPL, but generated API metadata can differ | GEGL/BABL/GTK and broad plugin ecosystem | mature raster editing, PDB/plugin integration, non-destructive filters | External interoperability/provider only in MVP; no core copying |
| Krita | current release pair 5.3.3 / 6.0.3 | C++ / Qt / KDE | GPLv3 as a whole; some files more permissive; extension API GPL | Qt/KDE, painting engine, layer/mask/document stack | brush/painting, masks, layers, animation, artist UX | Reference/external interoperability; no embedded plugin/core in permissive EveAtelier core |
| Skia | rolling main; no SemVer product release assumed | C++ | BSD-3-Clause | Large native graphics stack; GPU/Graphite/Ganesh options | vector/path/text/2D render/composite | Later native 2D backend candidate; not first MVP |
| `Comfy-Org/ComfyUI` | official indexed release 0.29.0 (2026-07-29); re-check before pinning | Python | GPL-3.0 | PyTorch/model ecosystem; graph/node runtime and HTTP/API backend | generate, inpaint, outpaint, model workflows | External provider over API; not linked/imported into EveAtelier core |
| `huggingface/diffusers` | release list includes 0.40.0; stable provider pin to be explicit at install time | Python | Apache-2.0 | PyTorch, transformers/huggingface-hub/safetensors depending pipeline | generate, variation, inpaint, image edit pipelines | Native Python generation provider; model licenses remain separate |

## Current extraction priority

### Tier A — use in the first implementation

- sharp / libvips
- OpenRaster-compatible codec
- Diffusers provider adapter
- ComfyUI external adapter
- LittleCMS metadata/plumbing boundary (direct native use may wait until color-management work)

### Tier B — immediately useful as source/reference, but not first hot path

- miniPaint
- GEGL
- Skia

### Tier C — later interoperability / specialized provider

- libmypaint
- GIMP
- Krita

## Version caveats

- Skia is treated as a rolling source project; pin a commit if adopted.
- GEGL upstream release pages observed 0.4.62; re-check before shipping because project releases may move independently of this inventory.
- ComfyUI is fast-moving; do not encode its release number into Operator semantics.
- Diffusers library license does not grant rights to every model downloaded through it. Model license/usage policy is a separate Provider input.
