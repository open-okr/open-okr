/**
 * Every endpoint the authentication catch-all answers, and whether it stays
 * on (docs/design/account-self-service.md §3, D26 to D28, plan 0.8.0 Y6).
 *
 * Better Auth serves every endpoint it and its plugins define, whether or not
 * a screen here uses it. Several of those changed an account with no record,
 * handed out an identity provider's tokens, or let any signed-in person
 * register a single sign-on provider. This list is the decision for each one,
 * and `disabledPaths` is built from it, so the two cannot disagree.
 *
 * `auth-endpoint-inventory.test.ts` builds the instance with every plugin
 * mounted and reads Better Auth's own route table. It fails naming any served
 * path missing from this list and any listed path nothing serves, so an
 * upgrade that adds an endpoint is a red build on the pull request that
 * brings it rather than an open door in production.
 *
 * **What off means.** `disabledPaths` answers 404 before the limiter and
 * before any hook, for HTTP only. A server call through `auth.api` never
 * meets it, which is what lets Security revoke a session and a later change
 * verify a password from server code. It compares the exact path, so a path
 * with a parameter cannot be listed; the three that would be off are
 * harmless with the rest in force and stay on (D28).
 */

type Method = "GET" | "POST";

interface AuthEndpoint {
  /** The path below `/api/auth`, as Better Auth's route table writes it. */
  readonly path: string;
  readonly methods: readonly Method[];
  readonly served: "on" | "off";
  /** Why, in a few words. Kept beside the entry so a reviewer reads both. */
  readonly why: string;
}

const on = (path: string, methods: readonly Method[], why: string) =>
  ({ path, methods, served: "on", why }) as const;
const off = (path: string, methods: readonly Method[], why: string) =>
  ({ path, methods, served: "off", why }) as const;

export const AUTH_ENDPOINTS: readonly AuthEndpoint[] = [
  // Better Auth's own.
  on("/sign-up/email", ["POST"], "Sign-up"),
  on("/sign-in/email", ["POST"], "Sign-in"),
  on("/sign-in/social", ["POST"], "OIDC sign-in buttons"),
  on("/callback/:id", ["GET", "POST"], "OIDC return"),
  on("/sign-out", ["POST"], "Harmless; the browser client may call it"),
  on(
    "/get-session",
    ["GET", "POST"],
    "Reads the caller's own session; the browser client may ask after a sign-in",
  ),
  on("/request-password-reset", ["POST"], "Forgot password"),
  on("/reset-password/:token", ["GET"], "The reset mail's link"),
  on("/reset-password", ["POST"], "The reset form"),
  on(
    "/send-verification-email",
    ["POST"],
    "Send the link again (email-verification.md D7)",
  ),
  on("/verify-email", ["GET"], "Confirmation and change links"),
  on("/error", ["GET"], "Where a failed provider sign-in lands"),
  on(
    "/change-password",
    ["POST"],
    "Security's Password card; guarded, counted, recorded and mailed in createAuth's hooks (D3, D8, D9, D11)",
  ),
  off(
    "/change-email",
    ["POST"],
    "Asks for no password; Your account's server action calls auth.api.changeEmail after its own refusals and the password, where mail can be sent (D14, D15)",
  ),
  off(
    "/verify-password",
    ["POST"],
    "A password check behind a session that nothing counts; server code calls auth.api.verifyPassword",
  ),
  off(
    "/update-user",
    ["POST"],
    "Writes users.name and users.image with no record (D25)",
  ),
  off("/update-session", ["POST"], "No session field to update"),
  off("/delete-user", ["POST"], "Y7 has its own flow"),
  off("/delete-user/callback", ["GET"], "Y7 has its own flow"),
  off(
    "/list-sessions",
    ["GET"],
    "Security reads the list through the adapter (session.ts)",
  ),
  off(
    "/revoke-session",
    ["POST"],
    "Security revokes through auth.api from a server action",
  ),
  off(
    "/revoke-sessions",
    ["POST"],
    "No screen. A stolen cookie could sign the owner out everywhere",
  ),
  off(
    "/revoke-other-sessions",
    ["POST"],
    "No screen. Y3's checkbox does it inside /change-password",
  ),
  off("/list-accounts", ["GET"], "No screen"),
  off(
    "/link-social",
    ["POST"],
    "No screen; a provider sign-in links through its callback",
  ),
  off(
    "/unlink-account",
    ["POST"],
    "No screen. Removes a password or a provider link with no record",
  ),
  off(
    "/get-access-token",
    ["POST"],
    "Hands the identity provider's tokens, sealed at rest, to any holder of the session cookie",
  ),
  off("/refresh-token", ["POST"], "The same, refreshed"),
  off(
    "/account-info",
    ["GET"],
    "Calls the identity provider with the stored token",
  ),
  off("/ok", ["GET"], "No screen and no probe uses it"),

  // The two-factor plugin.
  on(
    "/two-factor/enable",
    ["POST"],
    "Security's one-time code form; counted (D3), refused for a demo account (AS-Q8)",
  ),
  on("/two-factor/verify-totp", ["POST"], "Sign-in and enrolment"),
  on("/two-factor/verify-backup-code", ["POST"], "Sign-in"),
  on(
    "/two-factor/disable",
    ["POST"],
    "No screen, but the only way to turn a second factor off; counted (D3)",
  ),
  on(
    "/two-factor/generate-backup-codes",
    ["POST"],
    "No screen, but the only way to get new codes; counted (D3)",
  ),
  off("/two-factor/get-totp-uri", ["POST"], "No screen; enabling returns it"),
  off("/two-factor/send-otp", ["POST"], "No code sender is configured"),
  off("/two-factor/verify-otp", ["POST"], "No code sender is configured"),

  // The passkey plugin.
  on("/passkey/generate-register-options", ["GET"], "Add a passkey"),
  on("/passkey/verify-registration", ["POST"], "Add a passkey"),
  on(
    "/passkey/generate-authenticate-options",
    ["GET"],
    "Sign in with a passkey",
  ),
  on("/passkey/verify-authentication", ["POST"], "Sign in with a passkey"),
  on("/passkey/list-user-passkeys", ["GET"], "Security"),
  on("/passkey/delete-passkey", ["POST"], "Security"),
  off("/passkey/update-passkey", ["POST"], "No screen"),

  // The SSO plugin, mounted only when a SAML provider is configured.
  on("/sign-in/sso", ["POST"], "The SAML sign-in button"),
  on("/sso/saml2/sp/acs/:providerId", ["GET", "POST"], "SAML return"),
  on(
    "/sso/saml2/sp/metadata",
    ["GET"],
    "What an identity provider is configured from; public by design",
  ),
  on(
    "/sso/saml2/sp/slo/:providerId",
    ["GET", "POST"],
    "Has a parameter (D28). A provider's logout request only ends sessions",
  ),
  on(
    "/sso/saml2/logout/:providerId",
    ["POST"],
    "Has a parameter (D28). Needs a session; signs the caller out",
  ),
  on(
    "/sso/callback/:providerId",
    ["GET"],
    "Has a parameter (D28). Answers only for an OIDC provider the plugin holds, and saml-sync writes SAML rows only",
  ),
  off("/sso/callback", ["GET"], "No OIDC provider lives in the plugin"),
  off(
    "/sso/register",
    ["POST"],
    "Let any signed-in person register up to ten providers. providersLimit is 0 as well",
  ),
  off(
    "/sso/providers",
    ["GET"],
    "OpenOKR manages providers in sso_connections",
  ),
  off(
    "/sso/get-provider",
    ["GET"],
    "OpenOKR manages providers in sso_connections",
  ),
  off(
    "/sso/update-provider",
    ["POST"],
    "OpenOKR manages providers in sso_connections",
  ),
  off(
    "/sso/delete-provider",
    ["POST"],
    "OpenOKR manages providers in sso_connections",
  ),
];

/**
 * What `createAuth` hands Better Auth as `disabledPaths`: every path marked
 * off. A path with a parameter would never match, and the inventory test
 * refuses one marked off.
 */
export const DISABLED_AUTH_PATHS: readonly string[] = AUTH_ENDPOINTS.filter(
  (endpoint) => endpoint.served === "off",
).map((endpoint) => endpoint.path);
