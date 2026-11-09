---
"@openokr/web": minor
---

A desktop agent that speaks standard input and output rather than HTTP can now connect: `okr mcp` passes its messages to the instance's agent endpoint with an agent token, stored with `okr login --url <instance> --mcp-token <token>`. Every check and record stays on the instance, as over HTTP.
