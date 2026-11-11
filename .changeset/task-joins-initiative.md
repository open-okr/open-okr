---
"@openokr/core": patch
"@openokr/web": patch
---

An existing task can move into an initiative, or out of one, from the Initiative picker on the task's page, which offers the initiatives of the task's own space. Creating or changing a task now checks what it names: an initiative must be in the task's space and one the person can edit, and a key result must be one whose objective they can see. A task could previously name an initiative or key result of another workspace, or put itself on the board of an initiative its author could not open; those are now refused, and an import row that does so is reported rather than written.
