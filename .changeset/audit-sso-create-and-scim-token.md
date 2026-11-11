---
"@openokr/web": patch
---

Adding a single sign-on connection and minting a directory-sync token now write an audit row naming who did it. The token is never in the row. The routes answer as before.
