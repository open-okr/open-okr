---
"openokr": patch
---

The tokens an identity provider issues when somebody signs in are now
encrypted in the database.

Signing in through an OIDC provider stores three tokens on the person's
account: an access token, a refresh token and an ID token. They were kept
exactly as the provider issued them, so a database dump or a backup carried
live credentials for the organisation's own identity provider. They are now
sealed under the instance's root key, the same way AI provider keys, channel
credentials and SSO client secrets are, and opened only on the server when a
sign-in or a token refresh needs them. `./openokr rotate-key` re-wraps them
with everything else.

Tokens stored before this release stay readable and are sealed by a data
change. Run `pnpm db:change` once after upgrading, with
`OPENOKR_ENCRYPTION_KEY` in the environment. An instance nobody has signed
into through OIDC has nothing to seal. Until it runs, the next sign-in through
the provider replaces a person's tokens with sealed ones anyway.
