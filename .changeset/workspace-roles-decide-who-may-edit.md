---
"@openokr/web": minor
---

Who may edit an objective now comes from a role, not from a space.

A workspace has roles, and a role is a level per domain: objectives, KPIs,
initiatives, tasks, comments, spaces and the workspace itself, each at view,
comment, edit or manage. Four arrive with every workspace. Owner and Admin can
do everything, Member edits the work and comments, Viewer reads. An
administrator can change any of them except Owner, and can add their own.

Before this, who could edit an objective was decided by membership of the space
that owned it. That rule could only be stated by reading the binding table, it
could only be changed by moving people between spaces, and it had no screen.

**A role raises access and never lowers it.** A champion still holds their own
grant on their own objective, and no role takes it away. That is the same rule
two overlapping grants have always followed, and it is why this release changes
nothing for anybody: every member keeps what they had, and gains whatever their
role adds.

Existing workspaces are given the four roles and their members a role each: the
oldest member becomes Owner, anybody managing or coordinating a space becomes
Admin, everybody else becomes Member. A guest keeps no role at all, because a
guest was invited into one space and a workspace-wide role would hand them the
workspace.

The method is untouched. The phase gate before drafting and the six publish
gates are exactly where they were.
