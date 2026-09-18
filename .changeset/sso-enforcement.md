---
"openokr": minor
---

Single sign-on enforcement does something.

The setting has been stored since single sign-on shipped and read by nothing,
so a workspace that switched it on watched password sign-in carry on working.

A connection that enforces, and lists at least one email domain, now claims
those addresses. Somebody on a claimed address signs in through that identity
provider and through nothing else: a password, a sign-up, a password reset and
a passkey are all refused, and the refusal names the provider to use. That is
the point of enforcing. The organisation controls the account, so removing
somebody there removes them here, and a local credential outliving that
removal is the one thing the setting exists to prevent.

The refusal lands before the password is checked, so it says nothing about
whether the password was right.

**Enforcing with no domains listed does nothing.** An empty list means "every
member of this workspace" where the column is read per workspace, and the
sign-in page has no workspace, so applying it there would claim every address
on the instance. The provider form says so, and says how to undo an
enforcement that locked somebody out.

Enforcement is read live, so turning it off takes effect on the next attempt
rather than the next restart.
