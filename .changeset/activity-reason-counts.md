---
"@openokr/core": minor
"@openokr/web": patch
---

A new read, `notifications.reasonCounts`, returns how many unsnoozed notifications a member has in all, unread and per reason. Activity shows the number on each filter pill, counted on the server rather than over the page it lists. It is in the REST, command line and agent surfaces with the other notification reads.
