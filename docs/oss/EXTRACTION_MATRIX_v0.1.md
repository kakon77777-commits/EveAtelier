# EveAtelier OSS Extraction Matrix v0.1

Reuse classifications:

- `COPY_ADAPT` — selected source may be copied/adapted only when the exact file license is compatible and attribution is preserved.
- `LIBRARY` — depend on upstream as a library; do not fork internals by default.
- `EXTERNAL_PROVIDER` — run independently and communicate over a process/API boundary.
- `REFERENCE_ONLY` — study behavior/architecture; implement EveAtelier code independently.
- `REIMPLEMENT` — implement a public format/protocol/algorithm contract without copying another application's code.

| Capability | Preferred upstream | Classification | MVP? | Why |
|---|---|---|---:|---|
| crop / extract | sharp/libvips | LIBRARY | yes | High-performance deterministic primitive |
| resize | sharp/libvips | LIBRARY | yes | Deterministic, common formats, alpha/ICC aware |
| layer composite | sharp/libvips | LIBRARY | yes | Adequate for candidate/document assembly |
| alpha creation / application | sharp + EveAtelier code | LIBRARY + REIMPLEMENT | yes | Keep semantic operator contract ours |
| mask generation from known/color-key region | EveAtelier code | REIMPLEMENT | yes | Acceptance-path primitive, not worth importing editor state model |
| edge cleanup | sharp + EveAtelier code | LIBRARY + REIMPLEMENT | yes | Morphology/blur/composite pipeline owned by provider |
| recolor | sharp/libvips | LIBRARY | yes | Deterministic color matrix/tint path |
| OpenRaster read/write | OpenRaster 0.0.6 specification | REIMPLEMENT | yes | Interchange format; no need to copy GIMP/Krita implementation |
| ICC color management | LittleCMS core | LIBRARY | later/partial | MIT core is clean; native binding can be introduced when needed |
| optimized LittleCMS FastFloat | LittleCMS plugin | EXTERNAL_PROVIDER or EXCLUDE | no | Separate GPL3/commercial license boundary |
| browser editor interaction patterns | miniPaint | REFERENCE_ONLY initially | later | Avoid importing its GUI/store as product architecture |
| selected miniPaint MIT utility | miniPaint | COPY_ADAPT after file-level audit | later | Allowed only when specific utility materially saves work |
| freehand brush engine | libmypaint | LIBRARY | later | ISC and purpose-built; avoid reinventing pressure dynamics |
| general non-destructive processing graph | GEGL | EXTERNAL_PROVIDER initially | later | Library and op licenses are mixed; provider boundary keeps core clean |
| specific GEGL op | GEGL op | LIBRARY only if allowlisted | later | Must inspect operation's own license metadata; GPL3+ ops are not bundled in permissive core |
| GIMP editing interoperability | GIMP PDB/libgimp or process | EXTERNAL_PROVIDER | later | GPL application boundary; no core copy |
| Krita interoperability | Krita process/file exchange | EXTERNAL_PROVIDER / REFERENCE_ONLY | later | GPL application/extension boundary |
| native 2D vector/path renderer | Skia | LIBRARY | later | BSD-3, powerful but too heavy for first MVP |
| generation graph backend | ComfyUI | EXTERNAL_PROVIDER | yes | GPL app stays independent; EveAtelier speaks HTTP/API |
| native generation runtime | Diffusers | LIBRARY in Python provider | yes | Apache-2.0, provider-neutral adapter around it |
| relight / 2.5D | EveAtelier OFP-lite | REIMPLEMENT from own OFP theory | yes | Preserve own Operator semantics; minimal deterministic spike first |
| full OFP | own future implementation | REIMPLEMENT | no | Not necessary to validate MVP architecture |
| Canvas / Visual World | MRMIC/NVCL | EXTERNAL SIBLING / BRIDGE | yes | MRMIC retains Canvas authority; EveAtelier is domain/workbench layer |

## Explicit non-extractions

The first MVP will not copy:

- GIMP application core;
- Krita application or extension API code;
- ComfyUI Python modules into EveAtelier runtime;
- GEGL operations marked GPL3+ into a permissive core distribution;
- a miniPaint global application store / GUI architecture;
- third-party model weights without a separately validated model license.
