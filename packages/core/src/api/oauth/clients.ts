/**
 * Which clients may ask (AI-NATIVE-PLAN.md §8.2, P5-T08a).
 *
 * **A static allow-list, with dynamic registration arriving at P5-T08b.** Every
 * instance ships knowing the desktop agents people actually use, so the flow is
 * completable on a fresh install with nothing configured, which is the rule
 * every setting in this product follows. An operator adds their own with the
 * same shape.
 *
 * **A redirect is matched exactly, never by prefix.** A prefix match is how
 * authorisation codes leak: `https://client.example/cb` matching
 * `https://client.example/cb.attacker.test` is one character of carelessness
 * and a complete account takeover. The whole string, or no.
 */
import {
  activeOnly,
  type OAuthClient,
  oauthClients,
  type WorkspaceTx,
} from "@openokr/db";
import { eq } from "drizzle-orm";

/**
 * The clients an instance knows about before anybody configures anything.
 *
 * Deliberately short. Each entry is a piece of software whose redirect
 * addresses are published and stable; anything else registers itself.
 */
export const ALLOW_LISTED_CLIENTS: readonly {
  readonly clientId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
}[] = [
  {
    clientId: "openokr-cli",
    name: "The OpenOKR command line",
    // A loopback address with any port, which is what a local tool binds. The
    // port is not known in advance, so both forms are listed and the port is
    // compared separately by `redirectAllowed`.
    redirectUris: ["http://127.0.0.1/callback", "http://[::1]/callback"],
  },
];

/** Why a client was refused, in words the error response carries. */
export type ClientRejection =
  | "unknown_client"
  | "redirect_not_registered"
  | "redirect_insecure";

export type ClientResolution =
  | { readonly kind: "ok"; readonly client: OAuthClient }
  | { readonly kind: "rejected"; readonly reason: ClientRejection };

/**
 * Whether a loopback address is what this registration meant.
 *
 * RFC 8252 §7.3: a native application binds an ephemeral port, so the port is
 * not knowable at registration time and must be ignored on loopback, and only
 * on loopback. Everything else is compared whole.
 */
function sameRedirect(registered: string, offered: string): boolean {
  if (registered === offered) {
    return true;
  }
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(offered);
  } catch {
    return false;
  }
  const loopback = new Set(["127.0.0.1", "[::1]", "localhost"]);
  if (!loopback.has(a.hostname) && !loopback.has(`[${a.hostname}]`)) {
    return false;
  }
  return (
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search
  );
}

/**
 * Whether this address may receive a code for this client.
 *
 * Two questions, and both have to be yes: the client registered it, and it is
 * safe to send a code to. Plain HTTP is only ever allowed to loopback, where
 * there is no network for anybody to be listening on.
 */
export function redirectAllowed(
  client: { readonly redirectUris: readonly string[] },
  offered: string,
): ClientRejection | null {
  let parsed: URL;
  try {
    parsed = new URL(offered);
  } catch {
    return "redirect_not_registered";
  }

  const loopback =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]" ||
    parsed.hostname === "localhost";
  if (parsed.protocol === "http:" && !loopback) {
    return "redirect_insecure";
  }

  const registered = client.redirectUris.some((uri) =>
    sameRedirect(uri, offered),
  );
  return registered ? null : "redirect_not_registered";
}

/**
 * The client this identifier names, materialising an allow-listed one.
 *
 * **The allow-list is a fallback in the lookup, not a seeding step.** A seed
 * would have to run somewhere, and the only place that runs once per instance is
 * the first-run wizard, which an instance upgraded from an earlier release never
 * runs again. Writing the row the first time somebody actually uses the client
 * works on a fresh install and an upgraded one, needs nothing configured, and
 * happens exactly when it is needed.
 *
 * A row that already exists wins, so an operator who edited an allow-listed
 * client's addresses keeps their edit, and P5-T08b's registered clients are the
 * same kind of row read by the same query.
 */
export async function resolveClient(
  tx: WorkspaceTx,
  input: { readonly clientId: string; readonly redirectUri: string },
): Promise<ClientResolution> {
  const existing = await clientRow(tx, input.clientId);
  const client = existing ?? (await materialise(tx, input.clientId));

  if (!client) {
    return { kind: "rejected", reason: "unknown_client" };
  }
  const refusal = redirectAllowed(client, input.redirectUri);
  if (refusal) {
    return { kind: "rejected", reason: refusal };
  }
  return { kind: "ok", client };
}

async function clientRow(
  tx: WorkspaceTx,
  clientId: string,
): Promise<OAuthClient | undefined> {
  const [row] = await tx
    .select()
    .from(oauthClients)
    .where(activeOnly(oauthClients, eq(oauthClients.clientId, clientId)))
    .limit(1);
  return row as OAuthClient | undefined;
}

/** Writes an allow-listed client's row the first time it is used. */
async function materialise(
  tx: WorkspaceTx,
  clientId: string,
): Promise<OAuthClient | undefined> {
  const entry = ALLOW_LISTED_CLIENTS.find(
    (candidate) => candidate.clientId === clientId,
  );
  if (!entry) {
    return undefined;
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  const [row] = await tx
    .insert(oauthClients)
    .values({
      clientId: entry.clientId,
      name: entry.name,
      redirectUris: [...entry.redirectUris],
      source: "allow_list",
    })
    // Two people connecting the same client at once is one row, and the one
    // that lost the race reads what the winner wrote.
    .onConflictDoNothing()
    .returning();

  return (row as OAuthClient | undefined) ?? (await clientRow(tx, clientId));
}
