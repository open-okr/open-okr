---
"@openokr/web": minor
---

A key result's score is now computed from its progress at the close, and the
review may adjust it with a reason; both numbers are kept (METHOD.md §3.3).
The quarterly review's scoring stage shows the computed score, starts the
slider there in hundredths, and says what each grade means for its kind. The
score bands are now 1.0, 0.6 and 0.3: an aspirational key result reads
achieved, on target, partial or little progress, and a committed one is met
or missed. A workspace may choose Doerr's score colours, 0.7 and 0.4, or
forbid adjusting a computed score, which is then refused. `sessions.scoringStatus`
answers `computed`, `band` and `adjustment`.
