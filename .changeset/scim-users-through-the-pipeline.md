---
"openokr": minor
---

Directory sync provisions and deprovisions people.

The SCIM surface could create a user and list members. It had no way to say
somebody had left, which is the thing a directory integration exists for.

`PATCH`, `PUT` and `DELETE` on a user now answer the one question an identity
provider asks, in the shapes Okta and Entra actually send it. Somebody removed
from the directory is suspended: every session, token and grant of theirs stops
working, and nothing they wrote is erased. Restoring them in the directory
brings them back.

**Suspension, never deletion**, and a workspace will not suspend its last
administrator, so a directory cannot lock a workspace out of itself. That
refusal answers 409 with the reason, rather than failing quietly.

Provisioning now writes the way the rest of the product writes: accounts
through the authentication layer, membership through the one member funnel,
and an audit row for every change. Somebody the directory adds lands in the
workspace that issued the token rather than in a new workspace of their own,
and they can be provisioned on an invitation-only instance, which is the kind
that runs a directory.

Listing supports the `userName eq` filter providers use to reconcile. A filter
this surface cannot read is refused rather than answered with the whole
membership.

Groups are not mapped to spaces yet.
