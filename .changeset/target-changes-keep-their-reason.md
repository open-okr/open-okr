---
"@openokr/web": minor
---

A target change is kept on record, and easing one asks why.

Every change to a key result's target is now recorded with who made it, the
old and new values, and whether it eased the target, which means moving it
toward its baseline. Easing a target needs a written reason unless the
workspace made the reason optional in its practice settings. Making a target
harder never needs one. The rule applies the same way through the new
`goals.changeTarget`, through `goals.updateKeyResult` (which takes
`targetReason`), from the API and from the command line. An import is never
refused. `goals.targetHistory` lists the changes.

A key result removed on its own now appears in Admin, Deleted items, with
who removed it, and Restore brings it back with its value history through
`goals.restoreKeyResult`. One deleted along with its objective still comes
back when the objective is restored.

A migration adds the `key_result_target_changes` table.
