---
"@openokr/web": patch
---

The outbound guard now connects only to an address it checked, so a name that resolves differently the second time cannot reach a private address. A single sign-on connection's discovery, token and user-info addresses are checked when they are saved.
