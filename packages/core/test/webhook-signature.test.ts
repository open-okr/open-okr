import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  newWebhookSecret,
  webhookHeaders,
  webhookSignature,
} from "../src/webhooks/signature.ts";

/**
 * The Standard Webhooks signature (docs/design/outbound-webhooks.md W5).
 *
 * The first test is the scheme's own published example, so a receiver using
 * any of its libraries verifies what this signs. A signature that only agrees
 * with itself proves nothing about the receivers it is for.
 */

describe("the Standard Webhooks signature", () => {
  it("matches the scheme's published test vector", () => {
    expect(
      webhookSignature({
        secrets: ["whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"],
        id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
        timestamp: 1614265330,
        body: '{"test": 2432232314}',
      }),
    ).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("signs with both secrets during a rotation, one v1 signature each", () => {
    const current = newWebhookSecret();
    const previous = newWebhookSecret();
    const input = { id: "msg_1", timestamp: 1_700_000_000, body: "{}" };
    const both = webhookSignature({ ...input, secrets: [current, previous] });
    const parts = both.split(" ");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(webhookSignature({ ...input, secrets: [current] }));
    expect(parts[1]).toBe(webhookSignature({ ...input, secrets: [previous] }));
    for (const part of parts) {
      expect(part).toMatch(/^v1,[A-Za-z0-9+/]+=*$/);
    }
  });

  it("keys the HMAC with the secret's bytes, not its text", () => {
    const secret = newWebhookSecret();
    const key = Buffer.from(secret.slice("whsec_".length), "base64");
    expect(key).toHaveLength(32);
    const expected = createHmac("sha256", key)
      .update("msg_2.42.body")
      .digest("base64");
    expect(
      webhookSignature({
        secrets: [secret],
        id: "msg_2",
        timestamp: 42,
        body: "body",
      }),
    ).toBe(`v1,${expected}`);
  });

  it("makes a different secret every time", () => {
    const seen = new Set(Array.from({ length: 20 }, () => newWebhookSecret()));
    expect(seen.size).toBe(20);
    for (const secret of seen) {
      expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    }
  });

  it("carries the id, the timestamp in seconds and the signature as headers", () => {
    const headers = webhookHeaders({
      secrets: ["whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"],
      id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
      timestamp: 1614265330,
      body: '{"test": 2432232314}',
    });
    expect(headers).toEqual({
      "content-type": "application/json",
      "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
      "webhook-timestamp": "1614265330",
      "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    });
  });
});
