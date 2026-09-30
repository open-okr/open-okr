---
"@openokr/web": minor
---

Reminders sent by email, Slack, Teams and Telegram now say what they are about
and link to it.

Every reminder except a blocker's used to read "You have a reminder waiting in
OpenOKR", with no goal, no link and no button. Each one now opens with the
rule's own name and what it concerns, for example "Check-in due today: Become
the preferred platform for mid-market teams", and carries a link that opens
the right page. A check-in reminder offers the check-in itself: a button
straight to the check-in page by email, and a one-tap command that starts the
check-in conversation in chat. The links go through the ordinary sign-in;
nothing in a message signs anybody in.

The daily summary and the blocker card now get their links too. The instance
never passed its own address to them, so both went out without links.
