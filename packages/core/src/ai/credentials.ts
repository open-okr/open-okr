/**
 * AI credential sealing (AI-NATIVE-PLAN.md §3.3, §7, P2-T14).
 *
 * Sealing and opening a credential is exactly `packages/core/src/secrets/
 * key-ring.ts`'s own envelope encryption, reused rather than reimplemented:
 * a fresh data key per credential, wrapped by the root key ring, so root-key
 * rotation re-wraps data keys only. The masked hint is the one thing this
 * module adds that instance settings never needed, because a mail password
 * has nowhere to show itself and a provider key does.
 */
import { z } from "zod";
import { encryptSecret } from "../secrets/key-ring.ts";

/** The last few characters, enough to recognise a key without exposing it. */
const HINT_VISIBLE_CHARS = 4;

export function maskKeyHint(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= HINT_VISIBLE_CHARS) {
    return "•".repeat(Math.max(trimmed.length, 1));
  }
  return `••••${trimmed.slice(-HINT_VISIBLE_CHARS)}`;
}

/**
 * The longest key accepted. Provider keys run from under forty characters to a
 * few hundred for a signed gateway token, so this is room for any of them and
 * a refusal for a pasted document.
 */
const API_KEY_MAX_LENGTH = 4096;

/**
 * What a provider key can look like (completeness review M-36).
 *
 * A key travels as a bearer token in a request header, so it is visible ASCII
 * with no space inside it. A key pasted with a line break in the middle, or
 * with the curly quotes a word processor adds, can never work, and storing it
 * would give somebody a card that says "stored" and a provider that refuses
 * every request. It is refused here instead, while the person who pasted it is
 * still looking. The space around it is trimmed first, because that is what a
 * copy from a provider's dashboard usually carries.
 *
 * The issues Zod raises for it name the rule that failed and never the value,
 * so a refusal cannot echo the key back.
 */
export const aiApiKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(API_KEY_MAX_LENGTH)
  .regex(/^[\x21-\x7E]+$/);

export { encryptSecret as sealCredentialKey };
