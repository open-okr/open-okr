---
"@openokr/core": patch
"@openokr/web": patch
---

SAML sign-in reads its responses with `fast-xml-parser` 5.12.0. The version before it could spend CPU time that grows with the square of the input on a response holding an unclosed tag, so a crafted response could slow the server down. Nothing changes in how sign-in behaves.
