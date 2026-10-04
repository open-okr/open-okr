---
"@openokr/web": minor
---

The OKR list changes as you type, and stays in step across tabs.

Renaming an objective or a key result, typing a value, and removing a key
result on the OKRs screen now show at once, before the server answers. If the
server refuses, the row goes back to what it was and the reason is shown
beside the table. If somebody else changed the same title first, nothing is
overwritten: the list says who changed it and what it now reads, and offers
to keep yours or take theirs. Removing a key result offers Undo for six
seconds.

A change made in one tab appears in your other tabs without a reload, and a
change another member makes appears shortly after they make it.

"Mine" on the list and the diagram now also covers objectives where you own
a key result. The list's data is kept in memory and no longer written to the
browser's storage.
