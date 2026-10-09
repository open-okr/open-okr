---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/ui": patch
---

The AI screen tests a provider key when it is stored, and on request.

Every key stayed "unverified" for good, working or not, so an administrator
could not tell a working key from a wrong one. Storing a key now sends one
request of a few tokens, carrying no workspace content, to the provider's
cheapest model: an answer marks the key verified, a 401 or 403 marks it
invalid, and a provider that cannot be reached leaves it unverified and says
so. "Test the connection" runs the same test again.
