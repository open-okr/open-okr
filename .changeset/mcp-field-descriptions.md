---
"@openokr/core": patch
---

Agent tool fields now say what they hold and where to get them: every input
of the default `core` toolset is described (an id names the tool that lists
it, a date gives its format, confidence its 0 to 1 scale), and the same
descriptions reach other toolsets wherever the field name matches. About half
of all 886 agent tool fields are described; the rest follow family by family.
