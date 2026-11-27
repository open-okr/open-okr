---
"@openokr/core": patch
---

The FlowyTeam import now reads key result check-ins that have no objective check-in, and places tasks that have no project. Before, those check-ins were not read and not reported, and every task without a project was skipped. Key result check-ins are grouped into one check-in per objective and period, with the lowest confidence and the latest author. A group with no remark at all has nothing to write a check-in from, so its values are added to the key result history with their own dates instead, and the current value does not move. A task with no project goes to the space of the team that owns its key result's objective, then to its assignee's team, then to a new space "Tasks from OKRI.io" that holds every imported member. The report counts each case. OKRI.io needs the matching export build before this import can connect to it, because the query catalogue changed.
