/**
 * Proof Key for Code Exchange (RFC 7636, P5-T08a).
 *
 * **The one thing that makes a public client safe.** An external agent has no
 * client secret: it runs on somebody's laptop, so anything it could hold, an
 * attacker who stole the authorisation code could hold too. PKCE replaces the
 * secret with a per-request one: the client invents a verifier, sends only its
 * digest up front, and proves it knows the original when it redeems the code.
 * A stolen code is then worth nothing without the verifier, which never
 * travelled over the redirect.
 *
 * **`S256` only.** RFC 7636 also defines `plain`, where the challenge *is* the
 * verifier, which protects against nothing and exists for clients too old to
 * hash. Refusing it is one line, and accepting it would be a downgrade any
 * attacker could ask for.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** The only method this server accepts. */
export const CHALLENGE_METHOD = "S256";

/** RFC 7636 §4.1: 43 to 128 characters from an unreserved set. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidVerifier(verifier: string): boolean {
  return VERIFIER.test(verifier);
}

/** The challenge a client should have sent for this verifier. */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Whether this verifier produces the stored challenge.
 *
 * Compared in constant time. The challenge is not a secret in the way a token
 * is, but the comparison costs nothing and the habit is what stops the next
 * one from being a `===`.
 */
export function verifierMatches(input: {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: string;
}): boolean {
  if (input.method !== CHALLENGE_METHOD) {
    return false;
  }
  if (!isValidVerifier(input.verifier)) {
    return false;
  }
  const expected = Buffer.from(challengeFor(input.verifier));
  const stored = Buffer.from(input.challenge);
  if (expected.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(expected, stored);
}
