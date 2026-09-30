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

## What is encrypted at rest

A credential the instance has to use again is sealed under its root key
(`OPENOKR_ENCRYPTION_KEY`), each with a data key of its own, and
`./openokr rotate-key` re-wraps every one. A credential it only has to check
is hashed, so the original is never stored.

| Stored | How |
|---|---|
| AI provider keys, chat channel credentials, SSO client secrets, the mail password | Sealed under the root key |
| The access, refresh and ID tokens an OIDC provider issues when somebody signs in | Sealed under the root key. Opened only on the server, when a sign-in or a token refresh needs them |
| Session tokens, API tokens, agent access tokens, directory sync tokens, invitation links | Hashed |
| Passwords | Hashed by the sign-in library |
| Authenticator app secrets and backup codes | Encrypted by the sign-in library under `BETTER_AUTH_SECRET` |

**Identity-provider tokens stored before this release are in plain text until
the data change seals them.** Run it once after upgrading, with the root key in
the environment:

```sh
OPENOKR_ENCRYPTION_KEY=... pnpm db:change
```

It seals every token still in plain text and leaves the rest alone, so running
it again changes nothing. On an instance nobody has signed into through OIDC
it has nothing to do and needs no key. Until it runs, those tokens still work,
and the next sign-in through the provider replaces them with sealed ones.

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

The token may make 600 requests a minute, the same allowance an API token
has. Past that the directory is answered 429 with `Retry-After`, which says how
long to wait, so a large first sync slows down rather than being refused for
good. The limit is there so a runaway connector, or a leaked token, cannot hold
the database for everybody else.

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

**Browse the trail** with one filter: a date range, an action, a person or
agent, and a target type. **Show matching rows** lists them on the screen,
newest first, fifty at a time with older rows a click away. Each row says
when, who acted and through which channel when it was not the browser (Slack,
the API, an external agent), the action, the target, and its position in the
chain or that it is still waiting for one. The row's details stay out of the
list.

**Export as CSV** hands over the rows the same filter matches, with each
row's details, position and hash, so the file and a later verification can be
lined up against each other. The export is itself recorded, with the filter
that was used.

## Uploaded files

Every file is checked against a type list and a 25 MB ceiling. SVG is not on
the list, because it can carry script.

**Every image is re-encoded before it is stored.** A PNG, JPEG, GIF or WebP is
decoded and written out again in the type it claimed, so what is kept is
pixels the instance drew, not the bytes that arrived. The EXIF block goes with
it, and with that the camera and, from a phone, where the photo was taken. A
file that claims to be an image and is not one is refused. So is an image of
more than 100 megapixels, before it is decoded. A small preview is made at the
same time and shown beside the file in the list.

**A virus scan is optional, and off until you name a scanner.** Set
`OPENOKR_CLAMD_HOST` to a ClamAV daemon (clamd) the instance can reach, and
`OPENOKR_CLAMD_PORT` if it is not on 3310. From then on:

| When | What happens |
|---|---|
| A file is uploaded | It is listed as "being checked" and cannot be opened |
| clamd says it is clean | It opens as normal |
| clamd names a signature | It is "held back" for good. The signature is on the audit row for `blobs.recordScan` |
| clamd will not scan it, for example over its stream size limit | Held back too, because not checked is not clean. Raise clamd's `StreamMaxLength` to at least 25M |
| clamd cannot be reached | The file stays held and the scan is tried again. After ten failed tries the relay logs a dead letter |

Files uploaded before the scanner was named are not scanned after the fact.
Removing the scanner while files are still being checked leaves those files
held rather than releasing them unscanned, so let the queue clear first.
Nothing runs clamd for you: it is a second service, and Postgres is the only
one the product requires. Its signature updates need a connection, or a mirror
on an isolated network.

## Reaching out

Everything the instance sends goes through one guarded path: it validates the
literal host and every resolved address, refuses private and metadata ranges,
follows no redirect, and caps size and time. An instance with nothing
configured makes no outbound request at all, which is what makes an air-gapped
install work. See [the air-gap guide](../runbooks/air-gap.md).

## Next

- [People and access](people.md)
- [Operations](operations.md)
