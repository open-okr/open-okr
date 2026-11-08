---
"@openokr/web": patch
---

AI drafting, rewriting, check-in wording and thread summaries now work on Claude Sonnet 5.5, Opus 5.5 and Fable 5.1. Those models refuse the forced tool call the Anthropic driver used for every structured answer, so each of those features failed on them and quietly showed no draft. The driver now asks for structured output, which every current Claude model has, and keeps the forced tool only for older models without it.
