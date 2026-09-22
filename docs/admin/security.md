# Security

## Signing in

Three factors ship with every instance and need no configuration: a password,
a passkey, and a one-time code from an authenticator app with backup codes.
Session tokens are hashed at rest, and a member can list their sessions and
revoke one.

## Single sign-on

Admin, then **Single sign-on**. OpenOKR speaks OIDC and SAML 2.0 directly.
Neither needs a bridge. Pick the protocol first: the form then asks for that
protocol's fields and nothing else.

Both protocols:

| Field | What it is for |
|---|---|
| Provider id and display name | The button somebody sees on the sign-in page |
| Email domains | Which addresses this provider is for |
| Enforce | Whether those addresses may **only** sign in this way |

OIDC:

| Field | What it is for |
|---|---|
| Discovery URL | The usual way. The endpoints are read from it |
| Explicit endpoints | For a provider with no discovery document |
| Client id and secret | The secret is envelope-encrypted and never shown again |

SAML 2.0:

| Field | What it is for |
|---|---|
| Sign-on URL | Where the browser is sent. Your provider may call it the SSO URL or the login URL |
| Issuer | What the provider calls itself in the assertions it signs. An assertion from anybody else is refused |
| Signing certificate | The provider's public certificate, with or without its BEGIN CERTIFICATE header |
| Audience | Optional. Empty means this instance's URL, which is what most providers expect |

**A SAML provider needs three things from this instance**, and the connection
prints them once it is saved: the entity ID, the assertion consumer service
(your provider may call it the reply URL or the ACS), and the address of a
metadata document that states both. Hand your identity provider the metadata
document, or the two addresses if it prefers them typed in.

**A new provider takes effect on the next restart**, and so does its metadata
document. The client is built once when the process starts.

**Enforcing refuses the local factors for the domains you list**: a password, a
password reset and a passkey are all refused, and the person is told which
provider to use. That is the point of enforcing. Removing somebody at the
identity provider then removes them here, and a local credential that outlived
that removal would be the one thing enforcement exists to prevent.

Two things to know before you switch it on:

- **It applies to you too.** The administrator who enables it is refused a
  password like everybody else on that domain.
- **Enforcing with no domains listed does nothing.** An empty list would
  otherwise claim every address on the instance. The screen says so.

## Directory sync

Admin, then **Directory sync**. SCIM 2.0, which is how Okta, Entra ID and
others push people rather than being polled.

| The directory does | OpenOKR does |
|---|---|
| Creates a user | Creates the account and makes them a member of this workspace |
| Sends the same user again | Nothing. A directory replays its state, and a replay is not a new person |
| Deactivates a user | **Suspends** the member. Never deletes. Every session, token and grant stops working |
| Reactivates a user | Restores them |
| Creates or updates a group | Creates or updates a space, and makes its membership match |
| Deletes a group | Empties the space and leaves the space standing |

One bearer token per workspace, shown once, hashed at rest. Issuing a new one
revokes the old.

Two refusals worth knowing: the directory cannot suspend the last person with
full access, and losing a group is not leaving the workspace.

## Requiring a second factor

Admin, then General. Off unless an organisation asks for it.

On, anybody without a passkey or a one-time code is held in their own security
settings at their next page load: they can enrol, or sign out, and nothing
else. **It holds the administrator who switched it on as well.**

Accounts an identity provider manages are exempt. The provider already enforces
whatever second factor the organisation chose, and a second one here would be a
factor the organisation cannot administer or reset.

## The audit trail

Admin, then **Audit trail**.

Every sensitive action is recorded, and each row is hashed against the one
before it. Nobody can edit or delete a row: the database refuses updates and
deletes from every connection, including the owner's and a superuser's.

**Verify the chain** checks three things, and each catches a different attack:
every hash recomputes, which catches an edit; every row points at the one
before it, which catches an edit whose hash was recomputed to cover it; and the
positions run from one with no gaps, which catches a deletion. When it breaks
it says which position and why.

Rows written in the last minute or so may be counted as pending rather than
checked. The chain is built just behind the write path, so a busy workspace
always has a short tail waiting for its position. Pending is never counted as
verified and never reported as a break.

**Export the trail** hands over a CSV narrowed by date, action or target,
carrying each row's position and hash so the file and a later verification can
be lined up against each other. The export is itself recorded, with the filter
that was used.

## Reaching out

Everything the instance sends goes through one guarded path: it validates the
literal host and every resolved address, refuses private and metadata ranges,
follows no redirect, and caps size and time. An instance with nothing
configured makes no outbound request at all, which is what makes an air-gapped
install work. See [the air-gap guide](../runbooks/air-gap.md).

## Next

- [People and access](people.md)
- [Operations](operations.md)
