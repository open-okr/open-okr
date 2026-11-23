/**
 * Connecting a workspace to FlowyTeam (docs/design/flowyteam-connect.md §3,
 * §4.1, §4.4, §5; plan card C3).
 *
 * OAuth 2.0 authorisation code with PKCE S256 (a proof that the client which
 * asked for the code is the one exchanging it). The short-lived half of the
 * flow, the `state` value, the PKCE verifier and who started it, travels in a
 * sealed cookie rather than a table: it lives ten minutes, belongs to one
 * browser, and a row for it would be a credential with nobody to clean it up.
 *
 * **Nothing here reaches the network.** The calls to FlowyTeam go through a
 * gateway the host passes in (`FlowyteamGateway`), because the outbound guard
 * lives in `packages/adapters`, which this package may not import. The shape is
 * structural so the adapter satisfies it without importing anything from here.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
} from "../../secrets/instance-registry.ts";
import { readSecret, readSetting } from "../../secrets/instance-settings.ts";
import {
  decryptSecret,
  encryptSecret,
  type KeyRing,
} from "../../secrets/key-ring.ts";
import { isCloudEnabled } from "../../tenancy/settings.ts";

export const FLOWYTEAM_SOURCE = "flowyteam" as const;
/** Read-only, never granted together with another scope (§6 F1). */
export const FLOWYTEAM_EXPORT_SCOPE = "flowyteam:export";
/** The managed cloud's FlowyTeam when the setting is empty (§4.4). */
const FLOWYTEAM_CLOUD_URL = "https://app.flowyteam.com";
/** As long as FlowyTeam keeps an authorisation code. */
export const FLOWYTEAM_STATE_TTL_MS = 10 * 60 * 1000;
export const FLOWYTEAM_STATE_COOKIE = "openokr_flowyteam_connect";
export const FLOWYTEAM_CALLBACK_PATH = "/admin/imports/flowyteam/callback";
/** Where this instance publishes the client metadata document FlowyTeam reads. */
export const FLOWYTEAM_CLIENT_METADATA_PATH = "/api/imports/flowyteam/client";
/** The outbox topic that revokes a disconnected token at FlowyTeam. */
export const FLOWYTEAM_REVOKE_TOPIC = "imports.flowyteamRevoke";

const BASE_URL_KEY = "imports.flowyteam.baseUrl";
const CLIENT_ID_KEY = "imports.flowyteam.clientId";
const CLIENT_SECRET_KEY = "imports.flowyteam.clientSecret";

// ---------------------------------------------------------------------------
// The gateway: what the host does on the network for this flow
// ---------------------------------------------------------------------------

/** Why FlowyTeam did not give the answer asked for. */
export type FlowyteamFailure =
  /** 409 from the export endpoint: the two catalogues differ (Q8). */
  | "version_mismatch"
  /** 401 or 403: the token or the code is not accepted. */
  | "unauthorised"
  /** Any other 4xx, such as `invalid_grant`. */
  | "refused"
  /** No answer, a 5xx, or an address the outbound guard refused. */
  | "unreachable"
  /** An answer that is not the shape the protocol promises. */
  | "bad_answer";

export type FlowyteamAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly failure: FlowyteamFailure;
      readonly status?: number;
      /** For an operator's log. Never shown with a token in it. */
      readonly detail: string;
    };

export interface FlowyteamClientCredentials {
  readonly clientId: string;
  /** Present for a confidential client only. */
  readonly clientSecret?: string;
}

export interface FlowyteamGateway {
  exchangeCode(
    input: FlowyteamClientCredentials & {
      readonly baseUrl: string;
      readonly code: string;
      readonly codeVerifier: string;
      readonly redirectUri: string;
    },
  ): Promise<
    FlowyteamAnswer<{ readonly accessToken: string; readonly scope: string }>
  >;
  /** `companies.byId` through `POST /api/export/v1/query` (§6 F5). */
  readCompany(input: {
    readonly baseUrl: string;
    readonly accessToken: string;
    readonly version: string;
  }): Promise<
    FlowyteamAnswer<{
      readonly companyId: string;
      readonly companyName: string;
    }>
  >;
  /** RFC 7009 token revocation. Best effort: the caller decides what a failure means. */
  revoke(
    input: FlowyteamClientCredentials & {
      readonly baseUrl: string;
      readonly accessToken: string;
    },
  ): Promise<FlowyteamAnswer<null>>;
}

/**
 * What an administrator is told, per failure. A sentence, never the token and
 * never FlowyTeam's own words, which may name things the reader cannot act on.
 */
export const FLOWYTEAM_FAILURE_MESSAGES: Readonly<
  Record<FlowyteamFailure, string>
> = {
  version_mismatch: "FlowyTeam needs an update before this import.",
  unauthorised:
    "FlowyTeam did not accept this connection. Connect again, as a company admin.",
  refused: "FlowyTeam refused the connection. Connect again.",
  unreachable: "FlowyTeam could not be reached. Try again later.",
  bad_answer: "FlowyTeam answered in a way this instance does not understand.",
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function resolveString(pool: Pool, key: string): Promise<string> {
  const definition = getInstanceSetting(key);
  if (!definition) {
    throw new Error(`${key} is not declared in the instance registry`);
  }
  const stored = await readSetting(pool, key);
  const value =
    stored !== undefined && stored !== null
      ? stored
      : (environmentValue(definition, process.env) ?? definition.fallback);
  return typeof value === "string" ? value.trim() : "";
}

export interface FlowyteamSettings {
  /** Null when this instance offers no connect step (self-hosted, unset). */
  readonly baseUrl: string | null;
  /** The registered client id, or empty for the metadata document. */
  readonly registeredClientId: string;
}

export async function resolveFlowyteamSettings(
  pool: Pool,
): Promise<FlowyteamSettings> {
  const configured = await resolveString(pool, BASE_URL_KEY);
  const baseUrl =
    configured !== ""
      ? configured.replace(/\/+$/, "")
      : (await isCloudEnabled(pool))
        ? FLOWYTEAM_CLOUD_URL
        : null;
  return {
    baseUrl,
    registeredClientId: await resolveString(pool, CLIENT_ID_KEY),
  };
}

/** The address FlowyTeam sends the admin back to. */
export function flowyteamRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${FLOWYTEAM_CALLBACK_PATH}`;
}

/** The client id this instance presents: registered, or its metadata document. */
export function flowyteamClientId(
  settings: FlowyteamSettings,
  origin: string,
): string {
  return settings.registeredClientId !== ""
    ? settings.registeredClientId
    : `${origin.replace(/\/+$/, "")}${FLOWYTEAM_CLIENT_METADATA_PATH}`;
}

/**
 * The client credentials for a stored or starting connection.
 *
 * The secret is added only when `clientId` is the registered client. A
 * connection made through the metadata document before somebody registered a
 * client keeps revoking as the public client it was issued to.
 */
export async function flowyteamClientCredentials(
  pool: Pool,
  ring: KeyRing,
  clientId: string,
): Promise<FlowyteamClientCredentials> {
  const registered = await resolveString(pool, CLIENT_ID_KEY);
  if (registered === "" || registered !== clientId) {
    return { clientId };
  }
  const definition = getInstanceSetting(CLIENT_SECRET_KEY);
  const stored = await readSecret(pool, ring, CLIENT_SECRET_KEY);
  const fromEnvironment = definition
    ? environmentValue(definition, process.env)
    : undefined;
  const secret =
    stored ?? (typeof fromEnvironment === "string" ? fromEnvironment : "");
  return secret.trim() === ""
    ? { clientId }
    : { clientId, clientSecret: secret.trim() };
}

/**
 * The client metadata document a self-hosted instance is identified by
 * (draft-ietf-oauth-client-id-metadata-document). FlowyTeam requires
 * `client_id` to equal the address it fetched the document from.
 */
export function flowyteamClientMetadata(origin: string) {
  const base = origin.replace(/\/+$/, "");
  return {
    client_id: `${base}${FLOWYTEAM_CLIENT_METADATA_PATH}`,
    client_name: "OKRGoal",
    client_uri: base,
    redirect_uris: [flowyteamRedirectUri(base)],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: FLOWYTEAM_EXPORT_SCOPE,
  };
}

// ---------------------------------------------------------------------------
// PKCE and the sealed state cookie
// ---------------------------------------------------------------------------

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface FlowyteamConnectState {
  readonly state: string;
  readonly verifier: string;
  readonly workspaceId: string;
  readonly memberId: string;
  readonly baseUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

/** Why a callback's state was refused. One sentence for each, all `forbidden`. */
export type FlowyteamStateRefusal =
  | "state_missing"
  | "state_invalid"
  | "state_expired"
  | "state_mismatch"
  | "state_other_workspace"
  | "state_other_member";

export const FLOWYTEAM_STATE_MESSAGES: Readonly<
  Record<FlowyteamStateRefusal, string>
> = {
  state_missing:
    "This FlowyTeam connection was not started from this browser. Start it again from Import.",
  state_invalid:
    "This FlowyTeam connection could not be verified. Start it again from Import.",
  state_expired:
    "This FlowyTeam connection took longer than ten minutes. Start it again from Import.",
  state_mismatch:
    "This FlowyTeam answer does not belong to the connection started here. Start it again from Import.",
  state_other_workspace:
    "This FlowyTeam connection was started in another workspace. Switch to it, or start again here.",
  state_other_member:
    "This FlowyTeam connection was started by somebody else. Start it again from Import.",
};

export function newConnectState(input: {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly baseUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly now: number;
}): { state: FlowyteamConnectState; challenge: string } {
  const pkce = createPkcePair();
  return {
    state: {
      state: randomBytes(24).toString("base64url"),
      verifier: pkce.verifier,
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      baseUrl: input.baseUrl,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      expiresAt: input.now + FLOWYTEAM_STATE_TTL_MS,
    },
    challenge: pkce.challenge,
  };
}

/**
 * The state as a cookie value: the key ring's envelope (AES-GCM, so any change
 * to a byte fails to open) around the JSON, as base64url.
 */
export function sealConnectState(
  ring: KeyRing,
  state: FlowyteamConnectState,
): string {
  const sealed = encryptSecret(ring, JSON.stringify(state));
  return Buffer.from(
    JSON.stringify([sealed.keyId, sealed.dataKey, sealed.ciphertext]),
    "utf8",
  ).toString("base64url");
}

export type OpenedConnectState =
  | { readonly ok: true; readonly state: FlowyteamConnectState }
  | { readonly ok: false; readonly refusal: FlowyteamStateRefusal };

export function openConnectState(
  ring: KeyRing,
  cookie: string | undefined | null,
  now: number,
): OpenedConnectState {
  if (!cookie) {
    return { ok: false, refusal: "state_missing" };
  }
  let parsed: unknown;
  try {
    const parts = JSON.parse(
      Buffer.from(cookie, "base64url").toString("utf8"),
    ) as unknown;
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      !parts.every((part) => typeof part === "string")
    ) {
      return { ok: false, refusal: "state_invalid" };
    }
    const [keyId, dataKey, ciphertext] = parts as [string, string, string];
    parsed = JSON.parse(decryptSecret(ring, { keyId, dataKey, ciphertext }));
  } catch {
    return { ok: false, refusal: "state_invalid" };
  }
  if (!isConnectState(parsed)) {
    return { ok: false, refusal: "state_invalid" };
  }
  if (parsed.expiresAt <= now) {
    return { ok: false, refusal: "state_expired" };
  }
  return { ok: true, state: parsed };
}

function isConnectState(value: unknown): value is FlowyteamConnectState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    [
      "state",
      "verifier",
      "workspaceId",
      "memberId",
      "baseUrl",
      "clientId",
      "redirectUri",
    ].every((key) => typeof record[key] === "string") &&
    typeof record.expiresAt === "number"
  );
}

/** Compares the `state` FlowyTeam returned without leaking where it differs. */
export function sameState(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function flowyteamAuthorizeUrl(input: {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly challenge: string;
}): string {
  const url = new URL(`${input.baseUrl.replace(/\/+$/, "")}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", FLOWYTEAM_EXPORT_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
