---
"@openokr/core": minor
"@openokr/method": minor
"@openokr/web": patch
"@openokr/ui": patch
---

A champion with two or more goals due on the anchor day gets one message,
"Your check-ins this week", instead of one reminder per goal. It opens the
check-in walker, which holds every goal due and opens the first one with its
values filled in; in chat its button starts the check-in and offers the goals
that are due. One goal due keeps its own reminder. The new rule key is
`checkin.week`.
