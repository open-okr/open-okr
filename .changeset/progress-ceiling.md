---
"openokr": minor
---

A workspace may let progress pass 100%.

METHOD.md §3.1 clamped progress to 100 with a constant, so a key result that
reached 150 of a 100 target read exactly the same as one that stopped on the
number. The over-achievement survived only in the raw value and in the §3.6
forecast, which is deliberately unclamped.

The clamp is a §11 registry parameter now, `scoring.progressCeilingPct`. It
defaults to 100, so nothing changes for a workspace that does not ask, and it
may be raised as far as 200, which is the ceiling §6.4 already applies to KPI
achievement. It is editable on the rhythm settings card like every other
threshold.

Raising it reaches the goal rollup as well as the key result. A goal holding one
key result at 150% and one at 50% then reads 100% and looks complete while half
the work was missed, which is stated in METHOD.md §3.1 so that a workspace
raising the ceiling is accepting it rather than discovering it.

A *maintain* key result is never above 100 whatever the ceiling. Its value is
inside the stated band or on its way back, and there is no sense in which a
value inside a band exceeded it.

Scoring is untouched. A score is judged at the close by a person on the 0.0 to
1.0 scale, and a key result that overshot is still one whose target was set too
low.

One defect fixed on the way: the KPI-linked progress path carried its own
hardcoded cap of 100, so everything §6.4 measured above it was discarded and a
KPI at 180 was indistinguishable from one at exactly 100 on the key result that
linked to them.

Progress bars still draw on a 0-to-100 track and understate a value above 100.
That is a separate change.
