---
"openokr": minor
---

Signing in through your organisation's identity provider puts you in your
organisation's workspace.

Until now it did not. A workspace configured a provider, an employee signed in
through it, and they arrived alone in a brand new empty workspace of their own,
never seeing the one whose provider they had just used. The workspace that owns
the provider was read from the database at startup and then dropped before the
sign-in path could use it.

A first-time arrival now joins the workspace that configured the provider,
through the same funnel an invitation uses and at the same level every other
joining path gives. Nothing the identity provider sends decides what a new
member may do.

Somebody who is already a member is unaffected, and a repeat arrival adds
nothing: the workspace feed records people arriving, not a directory checking
its own work.
