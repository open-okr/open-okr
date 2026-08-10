/**
 * Invite tokens (TECHNICAL-PLAN §4.1, P2-T04).
 *
 * The same shape session tokens already use: a random raw value handed to
 * the invitee, and only its SHA-256 hex digest stored. A stolen database
 * row is useless to replay, because acceptance hashes what the URL presents
 * and compares hashes.
 */
import { createHash, randomBytes } from "node:crypto";

/** 32 bytes of randomness, base64url: short enough for a URL, long enough
 * that guessing is not a threat model worth defending against differently. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The domain half of an email address, lower-cased for comparison. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}
