---
"openokr": patch
---

A SAML provider can be configured from the admin screen.

SAML sign-in shipped with no way to switch it on. The form wrote OIDC columns
only, so a SAML connection could be created by editing the database and by no
other means, and the sign-in path built for it was unreachable.

Three things were in the way and all three are fixed.

The screen now asks which protocol first and shows that protocol's fields.
A SAML provider takes a sign-on URL, the identity provider's issuer and its
signing certificate, with an optional audience. What may be stored is decided
in one place for both protocols, so a refusal names the field to correct
rather than the database constraint that caught it. A certificate is parsed
rather than checked for a shape, because a string that is not a certificate
satisfied the column and would have failed at somebody's sign-in instead. A
certificate pasted without its BEGIN CERTIFICATE header is accepted, since
that is how one copied out of a metadata document looks.

Each SAML connection now prints this instance's entity ID, its reply URL and
the address of its metadata document, which is what an identity provider asks
for to configure its own side. The document is served after the next restart,
the same restart every connection on this screen already waits for.

The derived provider table the SAML plugin reads was never written by any
running instance, so a configured provider could not answer a sign-in. It is
brought in step at boot and again whenever a connection is created.

Enforcement covers SAML. An enforced domain whose provider speaks SAML could
not sign in by any route: the password was refused because enforcement claimed
the address, and the provider was refused because the sign-in was read as a
local factor. Both SAML paths are recognised now, and the sign-in page starts
a SAML sign-in the way the protocol requires rather than sending it through
the OIDC one.

No migration.
