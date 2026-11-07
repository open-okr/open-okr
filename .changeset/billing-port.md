---
"@openokr/web": patch
---

The groundwork for taking payment: a billing port with Stripe behind it, and the tables to record it. Nothing changes until a provider sets `OPENOKR_BILLING_PROVIDER`, and with it unset the Stripe code is never loaded.
