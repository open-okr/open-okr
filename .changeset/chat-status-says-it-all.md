---
"@openokr/core": patch
---

The chat `status` command answers with all three things its help promises:
the goal's health, how far it is, and when its next check-in is due.

It read field names the goal does not have, so it answered with the health
alone, written as a code ("health off_track"). It now says, for example,
"health off track, 42% of the way, next check-in 2026-10-16".
