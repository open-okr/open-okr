---
"@openokr/core": patch
"@openokr/web": patch
---

Every finished copilot answer has a Copy button, and the last one has Retry when it stopped, was cut short or failed, which asks the same question again. When a proposed change cannot be applied, the reason shows on that card rather than at the end of the conversation, and an applied card links to the objective, key result, initiative or task it made; `copilot.proposals` now returns that link as `href`. Deciding on a card no longer blocks asking a question, and an answer arriving no longer blocks the cards.
