---
"@openokr/web": patch
---

OpenOKR installs and upgrades on a Postgres with the pgvector extension, as managed Postgres offers by default. Migration 0031 no longer builds the index pgvector refused, so it stopped every such database; the migrator accepts the checksum an existing instance recorded for 0031 and updates it once. Migration 0166 makes the embedding column a vector on an instance that gains the extension later. Semantic search now checks the column rather than the extension, so a text column keeps to full text instead of raising, and compares only chunks of the question's size, so changing the embedding model no longer breaks it. The vector query itself also raised every time it ran, and no longer does.
