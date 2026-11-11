---
"@openokr/web": patch
---

The authentication endpoints no screen uses now answer 404. Among them, `/api/auth/update-user` changed an account's name with no record, `/api/auth/get-access-token` handed an identity provider's tokens to anybody holding the session cookie, and, once SAML was configured, `/api/auth/sso/register` let any signed-in person register a single sign-on provider, which is now refused from server code too. One list in `packages/core/src/auth/endpoints.ts` decides each endpoint, and a test fails the build when Better Auth serves one the list does not name. Nothing a screen does changes. `docs/admin/security.md` lists what is off and why.
