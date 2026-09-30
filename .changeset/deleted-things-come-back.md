---
"@openokr/web": minor
---

A deleted goal, initiative, task or document can be brought back, by an undo
straight after the delete or from a new Deleted items screen later.

The delete button on each of those four pages said "an administrator can bring
it back", and nothing could. Deletes were always soft, so nothing was lost, but
there was no restore and no list to find a deleted item on.

Deleting is now one press. The page you land on shows a message that says what
a delete is here and offers Undo for six seconds; pressing it restores the item
and takes you back to it. This replaces the old second "are you sure" press,
which the interface design never called for on something that can be undone.

Later, **Admin, Deleted items** lists what was deleted that you could restore,
newest first, with who deleted each one and when. Restore brings the item back
with what the delete took with it: a goal's key results, an initiative's links
to key results, a task's assignees and checklist. A task on a deleted
initiative, or a document on a deleted goal or initiative, is refused until the
parent is restored, and the refusal names the parent. Restoring asks the same
access the delete asked, and is recorded in the feed and the audit trail.

New API actions: `goals.restore`, `initiatives.restore`, `tasks.restore`,
`documents.restore` and `workspace.deletedItems`.
