---
"@openokr/web": minor
---

Teams checks in with a card, a space can post its digest to its own channel,
and a rule sent to a channel somebody cannot be reached on falls back.

**A rule's own channel is checked.** An administrator can send one nudge rule
to one channel, for example Slack. A member who had never linked Slack still
had that nudge sent to Slack, where it was dropped with nobody told. Now the
rule's channel is checked the way a member's own is: when it cannot reach them,
the nudge goes to their own channel, or by email when that cannot reach them
either, and the nudge records why. Nobody is told to reconnect a channel the
workspace chose for them.

**Checking in from Microsoft Teams is one card.** Typing `checkin` with a goal,
or pressing **Check in** on a reminder, answers with a card holding the three
questions. Pressing **Publish** writes the check-in exactly as the browser and
Slack do. It used to be four messages, one question at a time.

**A space can post its weekly digest to Slack or Teams.** A space manager pastes
the channel's ID into the space settings, for a provider the workspace has
connected. Once a weekly session has closed, its coordinator presses **Post to
the space's channel** on the session and the digest goes there once. The digest
records where it went.

This release adds a column to the nudges table. The upgrade runs it on its own.
