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

export { encryptSecret as sealCredentialKey };
