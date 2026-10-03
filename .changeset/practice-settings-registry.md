---
"@openokr/web": minor
---

Every workspace now has a practice profile and practice settings, readable
and changeable through the API and the `okr` command line.

METHOD.md §12 lists the choices an organisation makes about how it runs OKRs:
who may write and when, whether planning phases bind, how hard each quality
check and publish gate is, whether goals need a reviewer, which levels and
kinds of key result it uses, and how the quarterly review and close behave.
Five profiles set them as a group: Recommended, Google-style, Radical Focus,
Lightweight and Governed.

Three new actions: `practice.read`, which any member may call, and
`practice.update` and `practice.applyProfile`, which need full access and are
recorded in the audit log. Every workspace starts on Recommended with nothing
changed, and a migration adds the two columns that hold the choice.

Nothing in the product follows these settings yet, so this release behaves
exactly as the last one did. The settings screen and the behaviour arrive with
the rest of 0.2.0.
