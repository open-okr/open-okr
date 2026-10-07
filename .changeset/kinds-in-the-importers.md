---
"@openokr/web": minor
---

The spreadsheet templates have an optional kind column: committed or
aspirational for objectives, and metric, maintain, milestone or baseline for
key results, where a milestone or a baseline row needs no direction or
numbers. A file without the column is imported with the default kinds, and
the import's report now says so in a new "assumed" list, in the wizard and at
the command line. The FlowyTeam importer, whose source has no kind of either,
says the same in its notes. `imports.previewTable` and `imports.runTable`
answer the new `assumed` field.
