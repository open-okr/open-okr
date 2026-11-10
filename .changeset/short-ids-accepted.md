---
"@openokr/web": minor
---

Every REST call, agent tool, `okr` command and chat command that names a cycle, goal, key result, initiative, task, document or session now takes its short identifier as well as its UUID. A value that names nothing the caller can see, including one that is not an identifier at all, answers not-found rather than a validation error. The palette's jump by code finds all eight kinds, not only KPIs, and the agent's `fetch` tool reads a short link.
