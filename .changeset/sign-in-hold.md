---
"@openokr/web": minor
---

Wrong passwords now hold password sign-in for a while. Five in a row for one account from one network hold that network's next attempt for a minute, doubling to fifteen; twenty in a row from anywhere hold every network that has not signed in to the account in the last 30 days. Passkeys, single sign-on and a password reset still work and clear the hold. The sign-in page says how long to wait and links to the reset page. When an account hold begins, the instance audit chain records `auth.sign_in_held` and the account holder gets an email. Holds count in `openokr_sign_in_held_total`. The counts are kept in Postgres, so every replica shares them, and a daily job removes counts untouched for 30 days. Password reset requests are limited to five a minute per address, as intended; the rule named a path Better Auth no longer serves, so three applied. `auth.rate_limited` is written only for the address limiter's own refusals, with the address it counted.
