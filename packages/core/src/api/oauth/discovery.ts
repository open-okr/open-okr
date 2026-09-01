/**
 * What a client reads before it knows anything (RFC 8414, RFC 9728, P5-T08b).
 *
 * **A client that has been told only the instance URL has to be able to finish.**
 * That is the whole point of discovery: no operator pastes an endpoint, no agent
 * ships a hardcoded path. It reads three documents and knows where to send
 * somebody, where to redeem a code, and how to register itself.
 *
 * **Three documents rather than one, because three specifications ask for
 * three.** They overlap heavily and that is fine: each is served from one
 * builder, so they cannot disagree about which endpoint the token lives at.
 *
 * | Document | Specification | Answers |
 * |---|---|---|
 * | Protected resource metadata | RFC 9728 | "Which authorisation server guards this?" |
 * | Authorisation server metadata | RFC 8414 | "Where do I send a person, and redeem a code?" |
 * | OpenID configuration | OpenID Connect Discovery | The same, for clients that only look there |
 *
 * **The transport-suffixed variants exist because the specification puts the
 * path first.** RFC 9728 says the document for a resource at `/api/mcp` lives at
 * `/.well-known/oauth-protected-resource/api/mcp`, not at the resource's own
 * path with a suffix. Clients differ on which they try, so both are served.
 */
import { withoutTrailingSlashes } from "../../urls.ts";

/** Every scope this server issues, in the action registry's own vocabulary. */
export const SUPPORTED_SCOPES = ["read", "write", "destructive"] as const;

export interface DiscoveryPaths {
  readonly authorize: string;
  readonly token: string;
  readonly register: string;
  readonly resource: string;
}

/** Where each endpoint lives, relative to the instance. */
export const OAUTH_PATHS: DiscoveryPaths = {
  authorize: "/oauth/authorize",
  token: "/api/mcp/token",
  register: "/api/mcp/register",
  resource: "/api/mcp",
};

const at = (issuer: string, path: string) =>
  `${withoutTrailingSlashes(issuer)}${path}`;

/**
 * The identifier every grant is bound to and every token is checked against.
 *
 * **The protected resource, not the issuer**, which RFC 9728 settles: the thing
 * being guarded is the agent endpoint, and the metadata says so. A client that
 * reads that document and sends it back as RFC 8707's `resource` has to find
 * the same string here, and one function is what makes that true rather than
 * hoped for. The two were different for one task, and the transport is what
 * found it: a spec-following client would have been refused at the authorise
 * step, and every token minted before it would have been refused at the
 * endpoint.
 */
export function resourceIdentifier(issuer: string): string {
  return at(issuer, OAUTH_PATHS.resource);
}

/**
 * RFC 9728: what guards the resource, and what a client should ask for.
 *
 * The `resource` value here is the same string every grant is bound to and every
 * token is checked against, which is what makes "a token minted for another
 * instance" a comparison rather than a hope.
 */
export function protectedResourceMetadata(
  issuer: string,
): Record<string, unknown> {
  return {
    resource: at(issuer, OAUTH_PATHS.resource),
    authorization_servers: [withoutTrailingSlashes(issuer)],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

/**
 * RFC 8414: where to send a person, and where to redeem what comes back.
 *
 * `S256` is the only challenge method listed because it is the only one
 * accepted. Advertising `plain` and then refusing it would be a downgrade an
 * attacker could ask for and a support question for everybody else.
 */
export function authorisationServerMetadata(
  issuer: string,
): Record<string, unknown> {
  const base = withoutTrailingSlashes(issuer);
  return {
    issuer: base,
    authorization_endpoint: at(base, OAUTH_PATHS.authorize),
    token_endpoint: at(base, OAUTH_PATHS.token),
    registration_endpoint: at(base, OAUTH_PATHS.register),
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    // Every client here is public: an agent on somebody's laptop can hold no
    // secret an attacker could not also hold.
    token_endpoint_auth_methods_supported: ["none"],
    // RFC 8707. The token endpoint binds every grant to this instance.
    resource_indicators_supported: true,
  };
}

/**
 * OpenID Connect Discovery, for clients that look only there.
 *
 * This server issues no identity token and does not claim to. The document
 * exists because several agent runtimes read it first and give up when it is
 * missing, and what it says is true.
 */
export function openIdConfiguration(issuer: string): Record<string, unknown> {
  return {
    ...authorisationServerMetadata(issuer),
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: [],
    claims_supported: ["sub"],
  };
}

/**
 * The challenge an unauthorised answer carries (RFC 9728 §5.1).
 *
 * Points at the resource metadata, so a client that arrived without a token
 * learns where to go rather than only that it was refused. That single header
 * is what turns a 401 into the first step of the flow.
 */
export function challengeHeader(
  issuer: string,
  input: { readonly error?: string; readonly description?: string } = {},
): string {
  const parts = [
    `Bearer realm="OpenOKR"`,
    `resource_metadata="${at(issuer, "/.well-known/oauth-protected-resource")}"`,
  ];
  if (input.error) {
    parts.push(`error="${input.error}"`);
  }
  if (input.description) {
    // Quoted and stripped of quotes rather than escaped: a description is our
    // own sentence, and a header is not the place to be clever about quoting.
    parts.push(`error_description="${input.description.replace(/"/g, "")}"`);
  }
  return parts.join(", ");
}

/**
 * Every path a discovery document is served at.
 *
 * The suffixed forms are the specification's own: a resource at `/api/mcp` has
 * its document at `/.well-known/oauth-protected-resource/api/mcp`. Clients differ
 * on which they try first, and serving one is how a connection fails with
 * nothing in a log to explain it.
 */
export const DISCOVERY_ROUTES: Readonly<
  Record<string, (issuer: string) => Record<string, unknown>>
> = {
  "/.well-known/oauth-protected-resource": protectedResourceMetadata,
  "/.well-known/oauth-protected-resource/api/mcp": protectedResourceMetadata,
  "/.well-known/oauth-authorization-server": authorisationServerMetadata,
  "/.well-known/oauth-authorization-server/api/mcp":
    authorisationServerMetadata,
  "/.well-known/openid-configuration": openIdConfiguration,
  "/.well-known/openid-configuration/api/mcp": openIdConfiguration,
};

/** The document at one path, or null when nothing is served there. */
export function discoveryDocumentAt(
  path: string,
  issuer: string,
): Record<string, unknown> | null {
  const build = DISCOVERY_ROUTES[withoutTrailingSlashes(path) || path];
  return build ? build(issuer) : null;
}
