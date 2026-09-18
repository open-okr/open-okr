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
