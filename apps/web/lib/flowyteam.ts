import { createHttpFlowyteamGateway } from "@openokr/adapters";
import { loadEnv } from "@openokr/config";
import {
  FLOWYTEAM_STATE_COOKIE,
  FLOWYTEAM_STATE_TTL_MS,
  type FlowyteamGateway,
  isCloudEnabled,
  OperationError,
} from "@openokr/core";
import { getPool } from "./pool";

/**
 * The FlowyTeam gateway this host hands the connect actions and the relay
 * (docs/design/flowyteam-connect.md §4.1).
 *
 * A self-hosted instance may run next to its own FlowyTeam on a private
 * address, so the guard allows one there. The managed cloud never does: an
 * address inside its network is not somewhere a workspace should reach.
 */
export async function getFlowyteamGateway(): Promise<FlowyteamGateway> {
  return createHttpFlowyteamGateway({
    allowPrivate: !(await isCloudEnabled(getPool())),
  });
}

/** The relay's revoke, resolved per delivery like the rest of its settings. */
export const revokeFlowyteam: FlowyteamGateway["revoke"] = async (input) =>
  (await getFlowyteamGateway()).revoke(input);

/** The instance's own address, which FlowyTeam sends the administrator back to. */
export function instanceOrigin(): string {
  return loadEnv().BETTER_AUTH_URL.replace(/\/+$/, "");
}

/**
 * The state cookie's attributes. httpOnly, so no script reads the PKCE
 * verifier; Lax, so it travels on FlowyTeam's top-level redirect back and on
 * nothing a third site submits; scoped to the flow's own paths.
 */
export function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: instanceOrigin().startsWith("https://"),
    path: "/admin/imports/flowyteam",
    maxAge: Math.floor(FLOWYTEAM_STATE_TTL_MS / 1000),
  };
}

export { FLOWYTEAM_STATE_COOKIE };

/**
 * Where the administrator lands after the flow, with one word saying how it
 * went. The card (C5) turns the word into a sentence from the catalogue, so
 * nothing here hard-codes text a reader sees.
 */
export function importsPath(outcome: string): string {
  return `/admin/imports?flowyteam=${encodeURIComponent(outcome)}`;
}

/** The refusal's reason word, or `error` for anything that was not a refusal. */
export function outcomeOf(error: unknown): string {
  if (error instanceof OperationError) {
    const reason = error.details?.reason;
    return typeof reason === "string" ? reason : error.code;
  }
  return "error";
}
