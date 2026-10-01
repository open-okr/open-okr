---
"openokr": minor
---

OKRs can now be written on the screen where they are read.

The goals screen listed objectives and refused to create one. The empty state
pointed at the cycle screen, the cycle screen's form refused while the planning
phases were incomplete, and a key result could only be added on the drafting
surface. Four steps to reach a form that might then say no.

The set is now editable in place. An objective's title and a key result's title
are fields rather than text: click, type, press Enter. Add objective sits under
the set and Add key result under each objective's measures, and neither writes
anything until a title is typed, so a mis-click leaves nothing behind. Hover a
row, or reach it with the keyboard, and the open and delete controls are there.

A value typed into the table is recorded as history by the same action a
check-in uses, so the progress beside it moves and the history behind it has no
hole where somebody used the quicker door.

Three things deliberately did not move. Health is shown and never set: it is
derived from the check-ins and the confidence, and a second place to type it
would be a second opinion. Publishing still happens on the review screen, with
its gates. An objective added here is a draft, and the quality checks judge it
the moment it is saved rather than refusing it on the way in.

Two further views of the same cycle. Diagram draws the cycle, its objectives
and their key results as a tree of cards that pans and zooms. Tree is the
previous table, which is the only one of the three that indents by the
alignment parent.

The cycle on screen is chosen from a searchable picker beside the title rather
than from a row of chips that gained one every quarter, and a cycle can be
created from it. That creates the period's frame; the phases and their gates
are still set up on the cycle screen.

One new action, `goals.removeKeyResult`, which takes a measure off a goal. It
soft-deletes, so the value history behind it survives for the audit.
