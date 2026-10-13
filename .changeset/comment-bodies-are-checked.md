---
"@openokr/web": patch
---

A comment's body is checked against the rich text schema when it is written.

Posting or editing a comment accepted any body at all, so an API client could
store text that was not editor JSON, or a link to `javascript:`. Both writes
now hold a comment to the same schema an imported comment already met, and
refuse anything else without storing it. Comments written from the screen are
unaffected.
