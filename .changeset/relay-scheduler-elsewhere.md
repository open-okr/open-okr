---
"@openokr/web": minor
---

`OPENOKR_RELAY` and `OPENOKR_SCHEDULER` take a third value, `elsewhere`: not in this process, because another process of this instance runs it. A process with either set to `elsewhere` starts nothing and says so in its log (`relay: runs elsewhere`, `scheduler: runs elsewhere`). With the relay `elsewhere` the copilot still answers in the background, so the reader can close the tab and come back, and `/api/metrics` still serves the outbox gauges. With the scheduler `elsewhere`, `/api/status` judges the stamp the other process writes rather than answering `operational`, `/api/health` says `scheduler: "elsewhere"`, and Admin General warns, naming the worker, when no scheduler has completed a run for longer than the status check allows (four hours by default). `off` keeps its meaning, and any other value is refused at boot, naming the variable.
