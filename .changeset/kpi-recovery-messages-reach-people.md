---
"openokr": patch
---

The coach's KPI recovery messages now reach people in three cases where they
went nowhere.

A KPI measured only against its standing target, with no target recorded per
period, never earned its recovery proposal: every period read as having no
data. A KPI owned by the whole workspace told nobody when it left its
corridor; it now tells the workspace's administrators. And the message saying
a recovery can close was never sent, because the check that decided to send it
also marked it as already sent; it now arrives once.
