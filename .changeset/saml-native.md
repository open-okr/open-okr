---
"openokr": minor
---

Single sign-on speaks SAML, natively.

Until now it spoke OIDC only, and SAML was reached by putting a bridge in front
of the instance. The reason recorded for that was that Better Auth had no
native SAML. It does: `@better-auth/sso` is a first-party plugin, and it is
mounted here.

`sso_connections` stays the one place a provider is configured, with the tenant
policy it has always carried, and the plugin's own table is derived from it.
Which identity provider a workspace trusts is business data and belongs behind
the same floor as the rest of it.

Somebody arriving through a SAML provider lands in the workspace that
configured it, at the level every other joining path gives, and their session
behaves like any other. That is one path shared with OIDC rather than a second
one that looks similar.

Three fixes came out of driving a real assertion through, and two of them
affect OIDC as well:

Just-in-time provisioning was refused on every invitation-only instance, which
is every instance after its first account. The assertion verified, the audience
matched, and the account was refused at the last step. Configuring a provider
now counts as the workspace saying it will admit the people that provider
vouches for, which is what a directory token already meant.

An arrival through a provider could end up in two workspaces: the right one,
and a private one nobody opens. The path that resolves which provider somebody
came through only recognised one of the two protocols.

Configuring a SAML provider is the next release. This one makes the sign-in
work; there is no screen for it yet.
