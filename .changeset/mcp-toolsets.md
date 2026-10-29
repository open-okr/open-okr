---
"@openokr/core": minor
"@openokr/web": minor
"@openokr/ui": patch
---

The agent endpoint offers a small catalogue by default. A connection sees the
57 `core` tools a member uses every week unless its address names more with
`?toolsets=` (`core`, `work`, `facilitation`, `admin` or `all`), and it is shown
only the tools its token's scopes can call. Twenty actions that exist for the
importer, the scheduler, the copilot's own bookkeeping or the tokens screen are
no longer agent tools; they stay on `/api/v1`. An agent that relied on the full
list should add `?toolsets=all` to the server address. A call to a tool outside
the chosen toolsets is refused with the toolset that holds it.
