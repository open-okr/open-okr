---
"@openokr/web": minor
---

The quality checks know the four kinds of key result in METHOD.md §2.10:
metric, maintain, milestone and baseline. KR-2 is now "Verifiable" and judged
by kind, so a milestone with a date or a baseline passes where a metric would
need its numbers. KR-3 asks a target only of a metric or a maintain key
result, and a baseline only of a metric. KR-7 derives a metric's direction from
its baseline and target, asks no other kind for one, and when the two numbers
are the same asks whether the key result is a maintain or a milestone. Every
existing key result is a metric until the kind can be stored, so the visible
change today is KR-7 no longer refusing a metric whose numbers give its
direction.
