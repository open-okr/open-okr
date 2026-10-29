---
"@openokr/core": patch
---

An agent may send plain text to a rich text field (a comment body, a
check-in narrative, a goal description). The MCP dispatcher turns it into a
document of paragraphs before the action runs, and the tool schema says so.
REST and the command line still take editor JSON only, as 0.4 decided, and
their schema now names the shape it wants.
