---
"@openokr/web": patch
---

The upgrade step that queues old content for indexing no longer queues content whose indexing job is already waiting, so a fresh seed no longer pays for the same embedding twice.
