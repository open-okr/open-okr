---
"@openokr/web": minor
---

A member can rate a copilot answer with a thumbs up or down, and add a note after a thumbs-down. The note stays private to AI administrators unless the member chooses to share the conversation, and only then do they see the question and the answer. Ratings are kept for the same number of days as the agent activity record (migration 0170, additive, a new table), are deleted with the conversation or the member, and never leave the instance. Hidden while AI is off.
