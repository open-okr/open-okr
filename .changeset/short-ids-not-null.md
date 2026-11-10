---
"@openokr/web": minor
---

Every cycle, goal, key result, initiative, task, document and session now must have its short identifier: migration 0165 makes `short_id` not null on all seven. An instance that never ran data change 0034, including one upgrading straight from 0.6 or earlier, no longer has to run it by hand first: the migrator runs it before the migration and the start log names it, with its batches, rows and seconds. A migration can now name a data change it needs in the same way (`-- openokr:requires-data-change: <name>`).
