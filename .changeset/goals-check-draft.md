---
"@openokr/core": minor
---

A new read action, `goals.checkDraft`, runs the METHOD.md §4 quality checks
on an objective and its key results that have not been saved, and returns
each check's status, the condition it matched, its coaching prompt and the
strength score. It saves nothing and needs no AI provider. It is in the
default `core` agent toolset, so an agent drafting with its own model can
check a draft before `goals.create` publishes it, and the
review-against-the-canon prompt checks each rewrite with it.
