---
"openokr": minor
---

Erasing a member now removes their name from everywhere a workspace can read
it, and removes their sign-in account when this was their only workspace.

The erasure's own feed entry used to record the erased person's name, and
earlier entries about them kept it too. Neither does now, and existing entries
are cleaned by a data change. When the person belongs to no other workspace,
their account is anonymised, signed out and stripped of every way to sign in;
otherwise it is left for the workspaces they are still in.

Every member can also download what the workspace holds about them, from
Account, Security, Your data, without asking anybody.
