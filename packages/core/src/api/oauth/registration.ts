/**
 * Dynamic client registration (RFC 7591, P5-T08b).
 *
 * **An open registration endpoint is normal here and is not a hole.** Registering
 * grants nothing: it records a name and a set of redirect addresses. Every
 * authority still comes from a person approving a specific client on the consent
 * screen, in a specific workspace, with specific scopes. What registration buys
 * is that an agent nobody has heard of can start the flow without an operator
 * pasting anything.
 *
 * **What it must not become is a way to reach the private network.** A client
 * may hand over a metadata URL, and fetching a URL a stranger chose is exactly
 * the request-forgery problem, so every fetch goes through the outbound guard:
 * the literal host and every resolved address are checked, no redirect is
 * followed, and size and time are capped.
 *
 * **Redirect rules are checked at registration and again at authorisation.**
 * Twice, because a registration is a claim and an authorisation is a use, and a
 * check that only ran once would be a check that ran before the rules were last
 * changed.
 */
import {
  type OAuthClient,
  oauthClients,
  type WorkspaceTx,
  withInstanceAdmin,
} from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

/**
 * Schemes a redirect may never use, whatever a client asks for.
 *
 * `javascript:` and `data:` execute; `file:` reads the disk. None of them is a
 * place an authorisation code can be delivered to, and all three have been used
 * to turn a redirect into something else entirely.
 */
const DANGEROUS_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
]);

export type RegistrationRefusal =
  | "invalid_redirect_uri"
  | "invalid_client_metadata";

export type RegistrationOutcome =
  | { readonly kind: "registered"; readonly client: OAuthClient }
  | {
      readonly kind: "refused";
      readonly error: RegistrationRefusal;
      readonly description: string;
    };

export interface RegistrationInput {
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly metadataUrl?: string;
  /** False in development, where an operator runs everything over plain HTTP. */
  readonly requireTransportSecurity: boolean;
  readonly now: Date;
}

/**
 * Whether one redirect address may be registered.
 *
 * Three rules, and the middle one is the reason native applications work at all:
 * a desktop agent registers a custom scheme like `myagent://callback`, which is
 * how the operating system hands the answer back to the process that asked.
 * Allowing that scheme anywhere in the address would let a client claim
 * `myagent://anything`, so it is allowed only to a callback path.
 */
export function redirectRegistrable(
  uri: string,
  requireTransportSecurity: boolean,
): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `"${uri}" is not an address.`;
  }

  if (DANGEROUS_SCHEMES.has(url.protocol)) {
    return `${url.protocol} cannot receive an authorisation code.`;
  }

  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]" ||
    url.hostname === "localhost";

  if (url.protocol === "http:") {
    // Plain HTTP is only ever safe to loopback, where there is no network for
    // anybody to be listening on.
    return loopback
      ? null
      : "A plain HTTP address can only be a loopback address.";
  }

  if (url.protocol === "https:") {
    return null;
  }

  // A custom scheme, which is how a native application receives its answer.
  // The path is required so a client cannot claim the whole scheme.
  if (url.pathname === "" || url.pathname === "/") {
    return `${url.protocol}//${url.host} needs a callback path.`;
  }
  if (requireTransportSecurity && url.hostname === "") {
    // `myagent:/callback` with no host is legal in the specification and
    // ambiguous in practice, which is a bad combination for an address a
    // credential is delivered to.
    return `${uri} needs a host as well as a path.`;
  }
  return null;
}

/**
 * Records a client that asked to exist.
 *
 * Refuses rather than throwing: RFC 7591 defines the two error codes, and a
 * client reads them.
 */
export async function registerClient(
  tx: WorkspaceTx,
  input: RegistrationInput,
): Promise<RegistrationOutcome> {
  const name = input.clientName.trim();
  if (name === "" || name.length > 200) {
    return {
      kind: "refused",
      error: "invalid_client_metadata",
      description: "A client needs a name, of at most 200 characters.",
    };
  }
  if (input.redirectUris.length === 0 || input.redirectUris.length > 10) {
    return {
      kind: "refused",
      error: "invalid_redirect_uri",
      description: "A client needs between one and ten redirect addresses.",
    };
  }

  for (const uri of input.redirectUris) {
    const refusal = redirectRegistrable(uri, input.requireTransportSecurity);
    if (refusal) {
      return {
        kind: "refused",
        error: "invalid_redirect_uri",
        description: refusal,
      };
    }
  }

  // The identifier this server issues, not one the client chose. A client that
  // picked its own could claim another's, and every grant is keyed on this.
  const clientId = `okr_client_${crypto.randomUUID().replace(/-/g, "")}`;

  // openokr:allow-mutation: the calling Operation's own transaction.
  const [row] = await tx
    .insert(oauthClients)
    .values({
      clientId,
      name,
      redirectUris: [...input.redirectUris],
      source: "registered",
      ...(input.metadataUrl ? { metadataUrl: input.metadataUrl } : {}),
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();

  if (!row) {
    return {
      kind: "refused",
      error: "invalid_client_metadata",
      description: "That client could not be registered.",
    };
  }
  return { kind: "registered", client: row as OAuthClient };
}

/**
 * What RFC 7591 says a successful registration answers with.
 *
 * No `client_secret`, because every client here is public. Emitting an empty one
 * would be worse than omitting it: a client that finds the field will try to use
 * it.
 */
export function registrationResponse(
  client: OAuthClient,
): Record<string, unknown> {
  return {
    client_id: client.clientId,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
  };
}

/**
 * What a client metadata document claims about itself.
 *
 * Untrusted throughout: every field is read defensively, and the redirect rules
 * are applied to whatever comes back exactly as they are to a direct
 * registration.
 */
export interface FetchedMetadata {
  readonly clientName: string;
  readonly redirectUris: readonly string[];
}

/**
 * Reads a client metadata document a client pointed at.
 *
 * The fetch itself belongs to the caller, which passes the outbound guard in:
 * `packages/core` may not reach the network, and the guard lives in
 * `packages/adapters` where anything that does lives.
 */
export function parseClientMetadata(body: string): FetchedMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const document = parsed as Record<string, unknown>;
  const uris = document.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return null;
  }
  const redirectUris = uris.filter(
    (value): value is string => typeof value === "string",
  );
  if (redirectUris.length === 0) {
    return null;
  }
  const name =
    typeof document.client_name === "string" && document.client_name.trim()
      ? document.client_name.trim()
      : "An unnamed agent";

  return { clientName: name, redirectUris };
}

/**
 * Registers a client, with the transaction this needs (P5-T08b).
 *
 * **`withInstanceAdmin`, and the choice is worth stating.** A client registers
 * with the instance rather than a workspace, so there is no tenant setting to
 * apply, and `withContext` refuses a context with no key at all. Of the wrappers
 * that exist, this is the one that means "an instance-level fact". It carries
 * one power this handler does not use, writing `system_settings`, and the
 * alternative was a new wrapper that opens a transaction with no tenant setting
 * whatsoever, which would reach the auth tables as well. One unused power inside
 * a function that writes one table is the smaller hole.
 */
export async function registerClientForInstance(
  pool: Pool,
  input: RegistrationInput,
): Promise<RegistrationOutcome> {
  return withInstanceAdmin(drizzle(pool), (tx) => registerClient(tx, input));
}
