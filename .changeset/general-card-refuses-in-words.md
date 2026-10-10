---
"@openokr/web": patch
---

Admin > General says why a save was refused, instead of failing.

A timezone the server does not know, or a trusted domain that is not a domain,
sent the administrator to the error page, and any other refusal saved nothing
and said nothing. The card now stays where it is and names the problem, for
example "priya@northwind is not a domain", keeping what was typed so it can be
corrected. A save that works now says "Saved."
