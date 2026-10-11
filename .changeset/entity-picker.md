---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
---

People, spaces, cycles, key results and KPIs are found by typing.

On the OKR list, drawer and diagram, the goal page and decompose, choosing a
champion, an owner, a space, a cycle, a key result or a KPI is a list you
can search, not a long drop-down. Type part of a name, or a member's title or
a KPI's short id, and choose with the mouse or the keyboard. A member is shown
with their initials and title, and an agent is marked as one. Somebody who has
left the directory still shows as who they are.

In a workspace of more than two hundred members, the list asks the server as
you type rather than loading everyone.

For API clients: `people.directory` takes an optional `search` (words found in
a member's name or title), `kinds` and `limit`.
