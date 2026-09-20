# P8-T07c: SAML, natively rather than through a bridge

The decision this row was cut to settle, and the shape that follows from it.

## The decision

**`sso_connections` stays the one authority. The plugin is a mechanism.**

Agung settled it on 18 September 2026, from three options.

| Option | What it meant | Why not |
|---|---|---|
| Plugin replaces everything | Retire `genericOAuth` and `sso_connections` | Per-workspace SSO configuration would move to a table with no `workspace_id` and no policy, so business data leaves the tenant floor. Removing `sso_connections` also spans two releases (PLAN.md §5.1) |
| Plugin for SAML only | OIDC stays where it is, SAML goes in the plugin's table | Two tables and two paths for one concept, and the SAML rows still sit outside the floor. It postpones the problem rather than answering it |
| **Plugin as mechanism** | `sso_connections` is written by the product; the plugin's table is derived from it | Chosen |

## Why this is the shape that fits

**The hard rule is not negotiable here.** Every business table carries
`workspace_id` and a row-level security policy in the same migration. Which
identity provider a workspace trusts is business data by any reading, and the
plugin's `ssoProvider` table carries `organizationId` (for Better Auth's own
organization plugin, which this product does not use), no `workspace_id`, and
no policy.

**It is the arrangement the repository already uses with Better Auth
everywhere else.** Better Auth owns authentication: accounts, sessions,
credentials. The product owns its domain tables and feeds Better Auth from
them. `genericOAuth` is configured at boot from `sso_connections` today, and
the demo personas are created through `internalAdapter` rather than beside it.
This is the same seam, not a new one.

**It keeps what P8-T07a and P8-T07b built.** The `app.sso_lookup` policy that
made the boot read work, enforcement reading `enforce` and `email_domains`, and
just-in-time provisioning landing in the one member funnel are all written
against `sso_connections`. None of them has to move.

## The cost, stated

The plugin's table becomes derived state, and derived state can drift from its
source. Two things keep that manageable.

The write path is one action, so there is one place that has to keep them in
step rather than many. And the product never reads the plugin's table to
answer a question: it reads `sso_connections`. A drifted row makes a sign-in
fail, which is loud, rather than making an answer wrong, which is not.

## The shape

```
sso_connections            the authority. workspace_id, RLS, soft delete
      |                    kind = 'oidc' | 'saml'
      |
      |  on write, and at boot
      v
auth.api.registerSSOProvider / updateSSOProvider / deleteSSOProvider
      |
      v
ssoProvider                derived. Better Auth owns it
      |
      v
OIDC via genericOAuth  |  SAML via @better-auth/sso
      |
      v
provisionUser  ->  tryJoinWorkspaceForIdentity   (the P8-T07b funnel)
```

## What the schema gains

`sso_connections` gains a `kind` and the SAML fields. The OIDC columns stay
exactly as they are, so nothing already configured changes meaning.

| Column | For | Note |
|---|---|---|
| `kind` | both | `oidc` or `saml`. Defaults to `oidc`, so every existing row keeps its meaning without a backfill |
| `saml_entry_point` | saml | Where the browser is sent to authenticate |
| `saml_issuer` | saml | The identity provider's entity id |
| `saml_certificate` | saml | The provider's signing certificate. **Not a secret**: it is a public key, and treating it as one would mean encrypting something every provider publishes |
| `saml_audience` | saml | What this instance calls itself to the provider. Null means the instance URL |
| `saml_want_assertions_signed` | saml | Defaults true, and the admin screen does not offer false |

**The service provider does not sign its own requests in this version.**
`authnRequestsSigned` stays false, which means no private key of ours is stored
and no key rotation is invented for one. Providers that require signed requests
are a follow-up, and the row that adds it also adds the key handling; doing it
now would be storing a key nothing uses.

## Acceptance criteria

**Given** a workspace with a SAML provider configured,
**when** somebody signs in through it for the first time,
**then** they are a member of that workspace at the level every other joining
path gives, no second workspace is created, and their session behaves
identically to a password session.

**Given** an assertion whose signature does not verify,
**when** it arrives,
**then** it is refused and nobody is provisioned.

**Given** an assertion signed correctly but for a different audience,
**when** it arrives,
**then** it is refused.

**Given** an assertion whose condition window has passed,
**when** it arrives,
**then** it is refused.

**Given** a workspace whose `sso_connections` row is disabled or soft-deleted,
**when** somebody attempts that provider,
**then** it is refused, because the derived row is removed with it.

## Where the tests spend their weight

On the refusals, not on the happy path.

`samlify` has carried three advisories: a signature-wrapping bypass
(GHSA-r683-v43c-6xqv, critical, patched 2.10.0), a token replay
(GHSA-8jjf-w7j6-323c, high, patched 2.4.0-rc5) and an XML injection inside a
signed assertion allowing privilege escalation (GHSA-34r5-q4jw-r36m, high,
patched 2.13.0). The pinned version is 2.13.1, so all three are behind us.

The pattern is the point. SAML is a protocol where an assertion can be
correctly signed and still not mean what it appears to, and a suite that proves
a good assertion works proves the wrong thing. Every refusal above gets a test
with a fixture assertion built to fail in exactly that way.

## What this does not do

It does not change how OIDC works. It does not move enforcement. It does not
touch the member funnel, beyond pointing the plugin's `provisionUser` at the
same function the OIDC path already calls.

---

## What P8-T07c-b added, 20 September 2026

The surfaces. The part above is the path an assertion travels; this is how a
provider comes to exist and how enforcement treats it once it does.

### The defect this row found first

**`syncAllSamlProviders` had no caller in the application.** It was written at
P8-T07c-a, tested, and never run outside a test. The SAML plugin reads
`sso_providers` and that table is derived, so on every running instance it was
empty and the plugin had no provider to answer a sign-in with. The path P8-T07c-a
proved works was unreachable for the same reason the whole P8-T07 family has
been unreachable twice before: something that is built, green, and not wired to
anything.

It is called in two places now, and the two answer different questions:

| Where | Question it answers |
|---|---|
| `apps/web/lib/sso.ts`, at boot | Is the derived table in step with the authority, including rows removed while this process was not running |
| `createSSOConnection`, on the write | Does a provider configured just now exist for the plugin, without waiting for somebody to notice |

### The screen

| Field | OIDC | SAML |
|---|---|---|
| Provider ID, display name, email domains, enforce | yes | yes |
| Discovery, authorization, token, user info URL | yes | no |
| Client ID and secret | yes | no |
| Sign-on URL, issuer, signing certificate | no | yes |
| Audience | no | optional |

**One protocol's fields on screen at a time**, because a SAML provider has no
client secret and an OIDC provider has no certificate, so a combined form is
always half wrong.

**What may be stored is decided in one pure function.** The route held its own
rules and they covered one protocol, so a SAML provider posted to it was
refused for having no client secret, which it cannot have.
`validateSSOConnectionInput` answers for both and names the field, the endpoint
returns that name, and the form puts the message under the field it is about.

**The certificate is parsed, not pattern-matched.** Migration 0096's constraint
asks that the column is not null, so any string satisfies it and the failure
surfaces at somebody's sign-in. A bare base64 block is accepted too and stored
as PEM, because that is how a certificate copied out of a metadata document
looks.

### The metadata document

**It is the plugin's, served at
`/api/auth/sso/saml2/sp/metadata?providerId=<id>`, and unauthenticated.** An
identity provider fetching it has no session. Writing a second document here
would mean two descriptions of one service provider and no way to tell which
one somebody handed over.

`samlServiceProviderUrls` derives the three addresses an administrator needs
and the screen prints them beside the connection. All three are computed from
the base URL and the provider id, never stored, because a stored copy is the
one that drifts and the symptom would be an identity provider posting a valid
assertion to an address that answers 404.

**The document is served after the next restart**, because the plugin is
mounted at boot and only when a SAML provider already exists. That is the same
restart every connection on this screen already waits for, and the screen says
so.

### Enforcement

| Path | Before | Now |
|---|---|---|
| `/sign-in/social`, `/callback/:id` | a provider sign-in | unchanged |
| `/sign-in/sso` | a local factor, refused | a provider sign-in |
| `/sso/saml2/sp/acs/:id` | a local factor, refused | a provider sign-in |

The backstop refuses a local factor for a claimed address, so reading the two
SAML paths as local factors meant an enforced domain with a SAML provider could
not sign in **by any route at all**: the password was refused because
enforcement claimed the address, and the provider was refused because the
backstop did not recognise it.

`EnforcingConnection` and `SSOProviderInfo` carry the protocol now, so the
sign-in page calls `signIn.sso` for a SAML provider instead of `signIn.social`.
Every provider went to `signIn.social`, which for a SAML one reached a provider
`genericOAuth` had never been given.

### What this still does not do

- **No editing or removal from the screen.** A connection is created and then
  changed in the database. That was true of OIDC before this row and is not
  made worse by it, but it is the obvious next row.
- **No signed authentication requests.** As above: `authnRequestsSigned` stays
  false and no private key of ours is stored.
- **No IdP-initiated sign-in.** Service-provider initiated only, which is what
  a person pressing a button does.
