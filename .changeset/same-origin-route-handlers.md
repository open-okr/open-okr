---
"@openokr/web": patch
---

Route handlers that act on the session cookie now refuse a request another site caused, with a 403. The consent screen sends a refusal only to an address the client registered.
