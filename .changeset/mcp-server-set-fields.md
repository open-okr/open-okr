---
"@openokr/core": patch
---

An agent can no longer send `legacy` (the import identity) or `aiGenerated`
(the copilot's provenance label). The fields are gone from the tool schemas,
and a call that sends either is refused before anything runs. The importer,
the copilot, REST and the command line are unchanged.
