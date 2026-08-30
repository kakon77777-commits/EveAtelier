# EveAtelier License Boundary Audit v0.1

This is an engineering license-boundary inventory, not legal advice. The goal is to prevent the common mistake "open source means all code can be mixed into one binary under any license".

## Policy

Until the EveAtelier project license is selected, core code must avoid introducing a dependency that would force a project-wide copyleft decision unintentionally.

The default integration preference is:

1. permissive library,
2. LGPL library with clean dynamic/library boundary and obligations documented,
3. independent GPL external provider,
4. reference-only clean implementation.

## Upstream-specific boundaries

### miniPaint — MIT

Status: **LOW RISK FOR SELECTIVE SOURCE REUSE**.

Rules:

- exact copied/adapted files retain MIT copyright/license notice;
- dependencies are audited separately;
- do not import miniPaint's application architecture as EveAtelier canonical state merely because the source is permissive.

Decision: selected `COPY_ADAPT` is permitted after file-level review; initial MVP remains mostly `REFERENCE_ONLY` because sharp already covers deterministic backend operations.

### sharp — Apache-2.0

Status: **LOW RISK LIBRARY**.

Rules:

- retain Apache-2.0 notices/NOTICE obligations when distributing applicable material;
- sharp is a library facade over libvips, so libvips obligations remain relevant.

Decision: primary deterministic Node provider library.

### libvips — LGPL-2.1

Status: **LIBRARY BOUNDARY REQUIRED**.

Rules:

- consume through sharp first;
- do not copy libvips source into EveAtelier core;
- if distributing native libvips binaries, preserve license notices and LGPL relinking/modification rights as required by the license/distribution method.

Decision: indirect `LIBRARY` through sharp for MVP.

### OpenRaster 0.0.6

Status: **FORMAT IMPLEMENTATION**.

Rules:

- implement the interoperable file structure from the public specification;
- do not copy GIMP/Krita importer/exporter code;
- do not copy specification prose into EveAtelier beyond what is required for independent technical documentation.

Decision: `REIMPLEMENT` codec.

### LittleCMS core — MIT

Status: **LOW RISK CORE LIBRARY**.

Rules:

- core engine is MIT;
- include copyright/license notice when distributed.

Important exception: official FastFloat plugin is separately described as GPL3 for open-source use with a commercial license alternative. Do not assume the plugin inherits the MIT license of core LittleCMS.

Decision: core `LIBRARY` allowed; FastFloat plugin excluded from default MVP.

### libmypaint — ISC

Status: **LOW RISK LIBRARY**.

Rules:

- preserve ISC notice;
- optional GEGL integration brings GEGL's separate license graph, so use libmypaint without GEGL unless there is a specific reason.

Decision: later brush provider.

### GEGL — mixed LGPL/GPL surface

Status: **HIGH ATTENTION**.

Upstream states that the library itself is LGPL while sample command-line/GUI binaries are GPL. Operation metadata must be checked separately: operations such as `gegl:channel-mixer`, `gegl:waves`, and `gegl:cartoon` are documented as `GPL3+`.

Rules:

- never infer an operation's distributable license from the core library license;
- maintain an operation allowlist if embedding GEGL;
- initial integration is isolated `EXTERNAL_PROVIDER` or `REFERENCE_ONLY`;
- do not bundle GPL3+ operation modules into a permissive EveAtelier core without an explicit project-license decision.

Decision: external/provider-first, per-operation audit before any embedded use.

### GIMP — GPL application; mixed library boundary

Status: **EXTERNAL INTEGRATION ONLY FOR MVP**.

The top-level GIMP license states application core is GPL and says libgimp/other GIMP libraries are LGPL, while generated API metadata may label namespaces differently. Treat this as a reason to review the exact library/file/version before embedding anything.

Rules:

- do not copy GIMP application core;
- prefer PDB/process/file interoperability;
- no license conclusion is inherited from a generic "libgimp" label without exact artifact review.

Decision: `EXTERNAL_PROVIDER` / `REFERENCE_ONLY`.

### Krita — GPLv3 application and extension API

Status: **EXTERNAL / REFERENCE ONLY**.

Rules:

- do not embed Krita application/extension code into a permissive core;
- individual permissive files may be reviewed separately, but default assumption is no copying;
- use file interchange, external invocation, or independent implementation.

Decision: `REFERENCE_ONLY` initially; external interoperability later.

### Skia — BSD-3-Clause

Status: **PERMISSIVE BUT LARGE**.

Rules:

- preserve BSD notices;
- third-party dependencies bundled by a Skia build must be audited separately.

Decision: later `LIBRARY`, not MVP.

### ComfyUI — GPL-3.0

Status: **EXTERNAL PROVIDER**.

Rules:

- EveAtelier adapter communicates with an independently running ComfyUI instance;
- do not import/copy ComfyUI Python code into EveAtelier core;
- if EveAtelier ever redistributes a ComfyUI bundle, distribution obligations require a separate explicit packaging review.

Decision: HTTP `EXTERNAL_PROVIDER`.

### Diffusers — Apache-2.0 library

Status: **LOW RISK LIBRARY, HIGH ATTENTION MODEL CONTENT**.

Rules:

- Diffusers library code is Apache-2.0;
- model weights/configs downloaded through Diffusers have their own licenses and usage conditions;
- provider must record model identity/license metadata separately from library license.

Decision: Python `LIBRARY` provider.

## Distribution firewall

EveAtelier core packages must never require a GPL application to start. GPL providers are optional, separately launched, and discovered through capability probes.

```text
EveAtelier Core
  ├─ permissive / audited libraries
  ├─ LGPL libraries behind documented library boundaries
  └─ Provider Adapter
         │ HTTP / stdio / file protocol
         ▼
     GPL Application (optional, independent)
```

## Required pre-release audit

Before publishing binaries:

- generate full dependency license inventory;
- verify native prebuilt binaries and their transitive notices;
- verify every copied source file license;
- verify GEGL operation allowlist;
- verify model licenses separately from Diffusers/ComfyUI code;
- verify trademark/name usage for external products;
- select EveAtelier's own project license deliberately.
