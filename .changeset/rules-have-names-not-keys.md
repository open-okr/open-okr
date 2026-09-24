---
"openokr": patch
---

Rules, assists, schedules and channels are named on screen instead of being
listed by their internal identifiers.

The nudge volume page listed forty-five rules as `checkin.overdue` and
`quality.sandbagging_draft`. It now says "Check-in overdue" and "Draft targets
look too safe". The AI console names each assist by what it does for you rather
than by the function that does it, the agents page says "Every week" instead of
`schedule.weekly`, and a nudge in your inbox or your review queue says which
rule sent it in words. So does the label a screen reader announces on each rung
of an escalation ladder.

Counted across twenty-seven screens: sixty-seven of these were on display, and
three are now. Those three are not internal names. Two are what the AI models
are called, and the third is part of a web address an operator has to copy
exactly.

Nothing about what is stored changed. Every message, every nudge record and
every audit entry still carries its rule key, and the build still refuses a
message that cites a rule the method does not define. One consequence worth
knowing: an administrator reading the method document now matches a row on
screen by its name rather than by its key.
