---
"@openokr/web": minor
---

The quarterly review's diagnostic reads the rhythm a team actually kept
(METHOD.md §8.6). The rhythm is the share of due check-ins published on time,
measured from the check-ins with holiday weeks left out, where it was the
average of two survey answers; those two answers are shown beside it as a
cross-check. The cycle score averages the aspirational key results, with the
committed ones reported as the share met. The lines are 0.6 for the cycle
score and 75% on time for the rhythm, and the diagnoses read as hypotheses:
"Likely a strategy or OKR-quality problem", "Likely a rhythm problem". A
diagnostic read earlier keeps the verdict and numbers it was read on.

The lowest process-health statement becomes an improvement action with an
owner and a date, recorded with the review's actions.

`sessions.diagnostic` returns the measured share and its counts and the
committed share met (migration 0135). A workspace's own rhythm-score
threshold is removed by data change 0024, since its five-point number has no
meaning as a share.
