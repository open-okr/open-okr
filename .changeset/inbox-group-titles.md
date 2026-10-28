---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/ui": patch
---

Each group in the inbox names what it is about.

A group heading read only "Goal", so every objective's notifications looked
the same. It now shows the goal's title, or the space, initiative, task, KPI,
cycle or session name, and `notifications.list` returns it as `subjectTitle`.

The chip on a notification sent to a goal's reviewer reads "As reviewer"
instead of "To review", so it no longer reads as a task. What a reviewer owes
is listed under Review.
