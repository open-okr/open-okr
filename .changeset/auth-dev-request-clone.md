---
"@openokr/web": patch
---

Sign-in, sign-up and the session check work again under `next dev`. They failed with a 500 because the caller-address step copied the request in a way only the production server accepted.
