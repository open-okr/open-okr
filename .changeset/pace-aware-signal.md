---
"@openokr/web": minor
---

The progress signal knows the date (METHOD.md §3.7). By default it compares a
goal's progress with the progress expected for the day of its cycle: on pace
is green, more than 10 points behind is amber, more than 25 behind is red, so
a goal is no longer red just because the quarter is young. A workspace may
choose the absolute signal instead, which reads 75% and 50% as before. The
trend forecast now waits for four values and is drawn only for metric key
results (§3.6).
