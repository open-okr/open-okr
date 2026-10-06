---
"@openokr/web": minor
---

A space can mark its holidays (METHOD.md §7.4). The space home lists them and
lets whoever manages the space add or remove one. No check-in is due in a
holiday: a goal that would have been due moves on to the period after it, on
the same weekday, including goals already open when the holiday is marked. A
check-in or commitment nudge about the space on a holiday is recorded and not
sent, with the reason "holiday". The streak does not break across a holiday,
and booking a cycle's sessions leaves holiday weeks out.

A check-in period counts as a holiday when its last working day is inside a
marked span. `spaces.setHolidays` writes the list and `spaces.holidays` reads
it (migration 0131).
