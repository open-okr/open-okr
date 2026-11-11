---
"@openokr/web": patch
---

After Stop, the copilot keeps the words it had already written on screen as a stopped answer, also on deployments that answer in the background. The panel now waits the moment it takes for the answer to end and be saved, instead of looking for it before it was saved.
