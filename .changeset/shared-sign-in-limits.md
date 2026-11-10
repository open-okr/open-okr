---
"@openokr/web": patch
---

The per-address limits on sign-in, sign-up, the second-factor checks and password reset requests are counted in Postgres, so two replicas no longer allow twice the limit. Other authentication requests keep their in-process count, so checking a session costs no query. When ten wrong second-factor codes lock an account's second factor for 15 minutes, the instance audit chain records `auth.second_factor_locked`; the lock itself was already Better Auth's default and is now set explicitly.
