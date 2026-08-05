"use client";

import { passkeyClient } from "@better-auth/passkey/client";
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
  plugins: [twoFactorClient(), passkeyClient()],
});
