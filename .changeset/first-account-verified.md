---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/db": patch
"@openokr/ui": patch
---

The account the setup wizard creates is verified, so an instance with mail
configured before its first run no longer locks its operator out.

With mail configured, a verified address is required to sign in, and the
wizard's account was created unverified: finishing setup failed, and every
later sign-in was refused with the same words as a wrong password. The first
account is now created verified and signed in straight away. The data-change
`0025_verify_first_account` verifies the earliest account on an existing
instance (run `pnpm db:change`). A correct password on an unverified address
now says to open the confirmation link instead of "Those details did not
match".
