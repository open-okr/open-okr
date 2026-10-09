---
"@openokr/core": patch
"@openokr/adapters": patch
"@openokr/web": patch
---

Agents built on the current MCP SDK can connect and read the tool list.

The handshake echoed a protocol version the endpoint then refused on the
next request, so a client asking for 2025-11-25 failed right after
connecting; it is now answered with 2025-06-18. One tool's input schema had
no object type at the top, which made the whole tool list unreadable to the
official client. `resources/list` answers with an empty list instead of
"method not found".
