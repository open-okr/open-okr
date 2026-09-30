---
"openokr": patch
---

A single sign-on connection can be changed, turned off and removed from Admin,
Single sign-on.

The screen could add a connection and nothing else, so correcting a client ID,
replacing a client secret, taking a misbehaving provider off the sign-in page
or retiring one meant somebody running SQL on the database. Each connection
now has Edit, Turn off or Turn on, and Remove.

Edit opens the same form, filled in. The client secret is never sent back to
the browser: leave it blank to keep the stored one, or type a new one, which is
sealed under the root key like the first. The provider ID cannot be changed,
because it is part of the callback address your identity provider already
holds, and the form says so.

Turning a connection off takes it off the sign-in page and refuses sign-ins
through it, and turning it on restores it as it was. Removing one asks first.
Turning off or removing a connection that enforces single sign-on hands its
domains back to passwords, and the question names those domains before it
happens.

Every change works from the next sign-in, within a few seconds, with no
restart. Each is recorded in the audit log with the administrator who made it,
and is available to the API and the command line as `sso.listConnections`,
`sso.updateConnection`, `sso.setConnectionEnabled` and `sso.removeConnection`.

A removed connection's provider ID can be used again. The database kept it
taken, so a connection removed and added back under the same ID was refused.
