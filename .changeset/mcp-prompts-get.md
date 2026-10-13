---
"@openokr/core": patch
"@openokr/adapters": patch
"@openokr/web": patch
---

An agent can open the four prompts the MCP endpoint lists (weekly check-in,
review against the quality checks, prepare my review, what do I owe). The
endpoint listed them but answered "method not found" when a client asked for
one; each now answers with its starting question and the tools that answer it.
