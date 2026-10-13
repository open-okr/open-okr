---
"@openokr/core": patch
---

Moving a workspace with its archive keeps its own AI models and every
revision of an agreed annual frame.

The import wrote a list held in a Postgres array column as JSON, which the
column refused, and counted the row as skipped. A workspace's custom AI
models and each frame revision, with its written reason, were left behind.
The import now asks the database which of a table's columns are arrays and
writes those as arrays, so a column added later is written too.
