---
"@openokr/web": minor
---

The copilot can now propose three edits: an objective's title and description, a task's status and an initiative's status. The card shows the change as before and after, and Undo puts the old values back. Undo is refused when somebody changed the record after it was applied. When the workspace asks for a reason for anything added mid-cycle, the card asks for one before Apply. Adds the `reverse_payload` column to `proposed_changes` (migration 0168, additive).
