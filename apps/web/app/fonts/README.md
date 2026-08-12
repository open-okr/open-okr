# Fonts

Geist Sans, vendored. UIUX-PLAN.md §2: "Geist, self-hosted."

| | |
|---|---|
| File | `Geist-Variable.woff2`, 68 KB |
| Weights | 100 to 900, one variable file |
| Version | Geist 1.7.2, the `geist` npm package's `dist/fonts/geist-sans/Geist-Variable.woff2` |
| Source | <https://vercel.com/font>, published by Vercel in collaboration with basement.studio |
| SHA-256 | `a369fcf5628ea2aa4e1b9e2ec6a5b3624e365bda588e1f0f2f12b564f728fbb8` |
| Licence | SIL Open Font License 1.1, `LICENSE.txt` in this directory |

## Why the file is committed rather than fetched

`next/font/google` also self-hosts: it downloads at build time and serves from
this origin, so a browser never reaches Google. But it downloads **at build
time**, and an air-gapped build has no network. The plan's own constraint for
`packages/ui` is "no runtime dependency, no network call, safe for an
air-gapped install"; a build that cannot run without reaching fonts.googleapis
.com fails that in the one place it matters most.

Committing the file also pins what ships. A Google-hosted revision can change
metrics under a stable family name; this one changes when somebody replaces
the file and says so in the change.

`geist` is not a dependency of this repository. The file was extracted from the
published package once, and the version, source and checksum above are how you
verify it. To update, `npm pack geist@<version>`, copy
`package/dist/fonts/geist-sans/Geist-Variable.woff2` here, and update this
table.

## Licence obligations

The OFL requires the copyright notice and licence to travel with the font, so
`LICENSE.txt` sits beside it and ships in the Docker image the same way. Geist
declares **no Reserved Font Name**, so the family keeps its name.

The OFL is a font licence and imposes nothing on the AGPL-3.0 work that embeds
it. `pnpm check:licences` reads `pnpm licenses list`, which only sees npm
dependencies, so it will not report this file — that is why the provenance is
written down here instead.

## What is deliberately absent

- **Italic.** Nothing in the product sets `font-style: italic` except one
  mockup blockquote, which the fallback covers. Adding
  `Geist-Italic[wght].woff2` costs another 71 KB for that.
- **Geist Mono.** No surface calls for it yet. The rich text editor's code
  block (S-30) is the first thing that will, and it can bring the file with it.
- **Subsetting.** The Google build splits the family by `unicode-range` so a
  latin-only reader fetches roughly a fifth of this. This file is the whole
  character set in one 68 KB request. Worth revisiting if the font ever shows
  up in a performance budget, but not worth a build-time subsetting step now.
