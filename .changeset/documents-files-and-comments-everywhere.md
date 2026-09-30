---
"@openokr/web": minor
---

Documents, files and comments are on every page that should carry them, not
only the goal.

**Where they are.** The documents panel is on a goal, an initiative, a space's
home, a session and the cycle workspace. The files panel is on all of those and
on a task and a document. The discussion, with reactions on each comment and on
the thing itself, is on a goal, an initiative, a task and a published document.
A task's page used to say that comments and files were not kept on a task; it
now keeps both.

**Who sees them.** A comment or a reaction is readable and writable by whoever
reads what it is on, and by nobody else. `comments.create`, `reactions.add` and
`reactions.list` now check that, as `comments.list` always did. Only a
comment's author, or somebody who can edit what it is on, can delete it; before
this any member could delete any comment. A draft document has no discussion:
its author is told to publish it first, and anybody else gets not-found. A
comment on a key result now resolves through its goal instead of failing.

**The feed.** A file attached to a goal, a task, a space or an initiative is a
line in that subject's feed. It used to be recorded as being on a document
whatever it was on, so no feed showed it.

Migration 0103 lets a comment hang on an initiative. It widens a check
constraint and nothing else, so the previous release keeps working during a
rolling upgrade.
