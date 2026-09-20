"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The browser half of Better Auth. Plugins have to match the server's, or a
 * factor exists on one side only.
 *
 * No base URL: the client talks to this same origin, which keeps a
 * self-hosted instance working on whatever hostname it is served from
 * without configuration.
 */
export const authClient = createAuthClient({
  // `ssoClient` is what gives `signIn.sso`, which is how a SAML sign-in
  // starts (P8-T07c-b). OIDC providers go through `signIn.social` and did
  // not need it; the page sent SAML there too and reached a provider
  // `genericOAuth` had never heard of.
  plugins: [twoFactorClient(), passkeyClient(), ssoClient()],
});
