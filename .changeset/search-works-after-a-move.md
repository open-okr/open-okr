---
"openokr": patch
---

Search and the copilot's semantic search find a workspace's content after it
has been moved in from an archive. The import wrote every goal, key result,
KPI, document and comment, and nothing rebuilt the search or embedding index
for them, so a moved workspace searched as empty until each item was edited.
