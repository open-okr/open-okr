---
"@openokr/core": patch
---

The four agent prompts now name tools and inputs the server accepts. The
weekly check-in finds due goals with `goals.due`, opens the draft with
`goals.startCheckIn` before publishing it, asks for confidence from 0 to 1
and the status values `on_track`, `caution` and `off_track`, and asks for a
next action and any blocker when confidence is low. Blockers are read per
space, because `blockers.board` needs a space.
