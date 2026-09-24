---
"openokr": patch
---

A progress bar drawn beside a number above 100 now agrees with that number.

A workspace may raise its progress ceiling as far as 200. Until now every bar
was drawn on a 0-to-100 track whatever the value, so a goal at 150% filled the
track completely and told a screen reader, through `aria-valuemax`, that 100 was
the most there was, while the figure printed beside it said otherwise. Ten bars
now carry their own maximum.

Three of those had nothing to do with the ceiling and were wrong for longer.
KPI achievement has been measured 0 to 200 since the KPI engine shipped, and the
KPI grid, the KPI tree and the recovery board all drew it on a 0-to-100 track, so
a KPI at 180 and one at exactly 100 produced the same bar.

Four bars are deliberately unchanged: the cycle phase rail counts gates met out
of the total and is genuinely a percentage, two draw a score on its own 0 to 1
scale, and the last is the component gallery.

Form controls are no longer smaller than 16px below the 768 breakpoint. Safari
on iOS zooms the page when a smaller control takes focus and does not zoom back
out, so tapping a field moved the layout somewhere nobody asked for.
