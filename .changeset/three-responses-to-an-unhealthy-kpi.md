---
"@openokr/web": minor
---

An unhealthy KPI now asks for a decision (METHOD.md §6.5). Its card on the
recovery board offers three: fix it now, as a task with an owner, a date and a
space; add a key result for it to an open objective in the current cycle, or
name one that already answers it; or launch a recovery OKR, with the draft
shown first. Once answered, the card shows the answer until the task is done
or the objective closes, and then asks again if the KPI is still unhealthy.

A new action, `kpis.recordResponse`, records which task or key result answers a
KPI (migration 0127), and `kpis.recoveryBoard` returns it with each card's space
and named owner. Answering a KPI another way settles a pending proposed
recovery for it, and the coach proposes none while that answer is open. A
proposed recovery in the review inbox links to the other two responses.

The practice setting "Unhealthy KPI response" now takes effect: "Draft a
recovery OKR at once" has the coach propose on the first unhealthy period.
