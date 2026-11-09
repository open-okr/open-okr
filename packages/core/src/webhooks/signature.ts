/**
 * Signing a webhook the Standard Webhooks way (docs/design/outbound-webhooks.md
 * W5).
 *
 * A published scheme receivers already have libraries for, written here with
 * `node:crypto` so it needs no dependency:
 *
 * | Header | Value |
 * |---|---|
 * | `webhook-id` | The event's id, the same on every attempt |
 * | `webhook-timestamp` | Seconds since the epoch, when this attempt was signed |
 * | `webhook-signature` | `v1,<base64 HMAC-SHA256 of id.timestamp.body>`, one per secret, space-separated |
 *
 * The secret is `whsec_` and the base64 of 32 random bytes, and the HMAC key
 * is those bytes, not the text. Two signatures go out for a day after a
 * rotation, one per secret, so a receiver can change its secret without
 * dropping a delivery; a receiver checks that any one of them matches.
 */
import { createHmac, randomBytes } from "node:crypto";

const SECRET_PREFIX = "whsec_";

/** A new signing secret. Shown once, then only ever stored sealed. */
export function newWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64")}`;
}

/** The HMAC key a secret stands for: the bytes, not the text. */
function keyOf(secret: string): Buffer {
  const encoded = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret;
  return Buffer.from(encoded, "base64");
}

/**
 * The `webhook-signature` value for one body, signed with every secret given.
 *
 * Seconds, not milliseconds, because that is what the scheme says and what
 * every receiver's library compares against its own clock.
 */
export function webhookSignature(input: {
  readonly secrets: readonly string[];
  readonly id: string;
  readonly timestamp: number;
  readonly body: string;
}): string {
  const content = `${input.id}.${input.timestamp}.${input.body}`;
  return input.secrets
    .map(
      (secret) =>
        `v1,${createHmac("sha256", keyOf(secret)).update(content).digest("base64")}`,
    )
    .join(" ");
}

/** Every header a signed delivery carries. */
export function webhookHeaders(input: {
  readonly secrets: readonly string[];
  readonly id: string;
  readonly timestamp: number;
  readonly body: string;
}): Readonly<Record<string, string>> {
  return {
    "content-type": "application/json",
    "webhook-id": input.id,
    "webhook-timestamp": String(input.timestamp),
    "webhook-signature": webhookSignature(input),
  };
}
