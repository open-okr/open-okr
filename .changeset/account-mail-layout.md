---
"@openokr/core": patch
"@openokr/web": patch
"@openokr/ui": patch
---

The password reset and email confirmation mails have an HTML part in the
product's layout, beside the plain text, and are written in the instance's
language. One renderer builds both parts from the same content, so they
cannot differ; it escapes every value and fetches nothing, so it works on an
air-gapped instance. The other mails move to it next.
