/**
 * The three secrets the authorisation server hands out (P5-T08a).
 *
 * **The same shape as every other secret in this product**: a random raw value
 * handed over once, and only its SHA-256 digest stored. Nothing here can show a
 * secret a second time.
 *
 * **The prefix says which kind, and is a hint rather than evidence.** A code
 * presented where an access token belongs can be refused before a query runs,
 * and a person reading a log can tell the three apart. What decides is always
 * the table the digest was found in.
 */
import { createHash, randomBytes } from "node:crypto";

export type OAuthSecretKind = "code" | "access" | "refresh";

const PREFIXES: Readonly<Record<OAuthSecretKind, string>> = {
  code: "okr_code_",
  access: "okr_at_",
  refresh: "okr_rt_",
};

export interface MintedSecret {
  readonly raw: string;
  readonly hash: string;
}

/** 32 bytes of randomness behind a readable prefix. */
export function mintSecret(kind: OAuthSecretKind): MintedSecret {
  const raw = `${PREFIXES[kind]}${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashSecret(raw) };
}

/**
 * The digest stored for a code, an access token, a refresh token or an MCP
 * session id.
 *
 * **SHA-256 rather than a slow key derivation, and that is the right choice
 * here.** CodeQL reports this line as `js/insufficient-password-hash`, which is
 * the correct question asked of the wrong value. A password is short, chosen by
 * a person and guessable, so hashing it has to be made expensive. Every value
 * that reaches this function is 32 bytes from `randomBytes` behind a fixed
 * prefix, minted by `mintSecret` or `mintApiToken` and never chosen by anybody.
 * There is nothing to guess, so there is nothing for work factor to buy. What it
 * would cost is real: this runs on every request that carries a bearer token,
 * and a deliberately slow hash on that path is a denial of service somebody
 * could trigger with a made-up token.
 *
 * The alert exists because `packages/core/test/oauth-flow.test.ts` hands a
 * minted API token to the resolver, to prove the two token tables are separate.
 * CodeQL reads "token" as "password" and follows it here. It is dismissed as a
 * false positive on the repository's code scanning page rather than suppressed
 * with a comment, so the judgement is recorded where a reviewer of the alert
 * will actually meet it.
 */
export function hashSecret(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

/** Which kind the text claims to be. A hint, never the answer. */
export function kindFromText(raw: string): OAuthSecretKind | null {
  const value = raw.trim();
  // Longest prefix first: `okr_at_` and `okr_rt_` share no prefix, but a future
  // kind might, and ordering by length is what stops that being a silent bug.
  const entries = Object.entries(PREFIXES).sort(
    ([, a], [, b]) => b.length - a.length,
  );
  for (const [kind, prefix] of entries) {
    if (value.startsWith(prefix)) {
      return kind as OAuthSecretKind;
    }
  }
  return null;
}

/**
 * How long each secret lives.
 *
 * Constants rather than §4.14 settings, for the same reason the API rate limit
 * is one: these bound the damage a stolen secret can do, and nobody should have
 * to configure a value to be protected. A code lives long enough for a browser
 * redirect and no longer.
 */
export const CODE_TTL_SECONDS = 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
