# Third-Party Notices

This file records direct runtime components introduced by EveAtelier v0.2 Workbench
Core. It is an engineering distribution aid and does not replace the complete license
texts supplied by each dependency.

## sharp 0.35.4

- Project: `lovell/sharp`
- License: Apache License 2.0
- Integration: direct Node.js production raster library
- Source and license: distributed in the installed `sharp` package

EveAtelier does not copy or modify sharp source. The package is resolved exactly through
`package-lock.json`.

## Sharp Windows platform package and libvips 8.18.6

- Project: `libvips/libvips`
- Installed package: `@img/sharp-win32-x64@0.35.4`
- Machine-readable package license: `Apache-2.0 AND LGPL-3.0-or-later`
- Integration: native image-processing library used through sharp
- Distribution boundary: dynamically packaged platform dependency selected by sharp

Redistribution must preserve the exact platform-package notices and the applicable
LGPL relinking/modification rights for the distributed native library. EveAtelier does
not copy libvips source into its core. The older inventory's generic LGPL-2.1 statement
is not used as the machine-readable license claim for this pinned Windows artifact.

## Bundled image and color libraries

The selected sharp platform package reports bundled codecs and libraries including
libheif 1.23.2 and Little CMS 2.19.1. Their notices and transitive licensing must be
included in a release-time dependency inventory. No EveAtelier binary release is made
by this milestone.

The previously evaluated sharp 0.35.3 package was not retained because the package
registry reported a high-severity bundled-libheif advisory fixed by 0.35.4.
