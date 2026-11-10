---
"@openokr/web": minor
---

Admin, Agents updates on its own as runs start, take steps and stop, without a reload. Each change sends only the run's id and version, and the screen re-reads the runs it may see. Cancelling a run that has just finished is now refused rather than marking it cancelled.
