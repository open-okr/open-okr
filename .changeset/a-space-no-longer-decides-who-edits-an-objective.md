---
"@openokr/web": minor
---

A space no longer decides who may edit an objective in it.

It did, and that was the only answer to the question: every member of the
owning space held edit on every objective in it. The rule could be stated only
by reading the access tables, it could be changed only by moving people between
spaces, and no screen showed it.

The workspace role answers it now, on the roles screen an administrator can
edit. That is what makes the screen mean anything: before this, lowering Member
on objectives changed no level anywhere, because the space binding still
granted the edit underneath it.

Nobody loses the edit when this release lands. The role backfill runs first and
gives every active member the Member role, which grants edit on objectives, so
the level is the same number from a different source. What changes is that an
administrator can now change it.

Who can **see** an objective is untouched. Every member of the workspace reads
every objective, as they always have.

An initiative follows the same rule: its space no longer grants edit either,
and the role decides. The owner keeps full control of their own initiative.

A space still decides its own membership, its session cadence and everything
that reads them.

**A review is unchanged for everybody in the room.** Scoring a key result,
writing the narrative, taking the close decision and revealing the votes used
to ask for edit on the objective, which worked only because a space granted it
to everybody. They ask to see the objective now, and being in the room is what
says you may take part. Somebody outside the room still cannot, and somebody
holding the narrowest role can still score with their team, which is what the
method asks for.
