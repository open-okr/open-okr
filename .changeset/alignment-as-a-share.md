---
"@openokr/web": minor
---

Alignment health is now a share (METHOD.md §5.2): of the goals below company
level, how many align to a parent or say why they stand alone. 90% and above
is healthy, 80% to below 90% is watch, and below 80% is a gap; a cycle with no
company objective at the top reads as a gap whatever the share. The fixed
penalties are gone, so the same unaligned goals no longer cost the same points
in a small company and a large one.

- A goal may now record why it stands alone, through `goals.update`
  (`standaloneReason`), and then counts as aligned. Setting a parent clears the
  reason, and setting a reason clears the parent.
- A parent in another space or another cycle, such as an annual objective,
  aligns a goal, and an annual company objective anchors the quarter under it.
- `alignment.read` adds `band`, `watchThreshold`, `anchored`, `measured` and
  `counted`. The score is a percentage, and the screens show it with "%".
- The "Alignment penalties" threshold is retired, and data change 0019 removes
  it from stored settings. "Alignment watch threshold" (80) is new, and the
  "Alignment healthy threshold" default moves from 75 to 90. A workspace that
  set its own healthy threshold keeps that number, which now reads as a share.
