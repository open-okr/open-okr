---
"@openokr/cli": patch
---

`okr mcp` refuses a profile address that is not https (except localhost) and refuses to follow a redirect, so the agent token is only sent to the address in the profile.
