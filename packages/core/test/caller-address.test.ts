import { describe, expect, it } from "vitest";
import { callerAddress } from "../src/auth/caller-address.ts";

/**
 * Whose address a request is counted under (completeness review M-12).
 *
 * | Property | What it stops |
 * |---|---|
 * | One forwarded address is trusted, as the shipped proxy writes it | A limit that cannot tell two callers apart |
 * | A chain of several is not, because its first entry is the caller's own | A caller escaping a limit by writing a new address on every request |
 * | Every caller that cannot be placed shares one count | An untrusted caller getting a fresh window each time |
 *
 * The configuration is the sign-in lockout's own: `createAuth` hands Better
 * Auth the same header list, and this asks Better Auth's own resolver.
 */

const from = (headers: Record<string, string>) =>
  callerAddress(new Headers(headers));

describe("the caller's address", () => {
  it("is the one address a proxy wrote into X-Forwarded-For", () => {
    expect(from({ "x-forwarded-for": "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("falls back to X-Real-IP when there is no forwarded address", () => {
    expect(from({ "x-real-ip": "198.51.100.1" })).toBe("198.51.100.1");
  });

  it("does not trust the first entry of a chain, which the caller wrote", () => {
    const spoofed = from({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(spoofed).not.toBe("203.0.113.9");
    // Counted with everybody else the instance cannot place.
    expect(spoofed).toBe(from({}));
  });

  it("does not trust a value that is not an address", () => {
    expect(from({ "x-forwarded-for": "anything-at-all" })).toBe(from({}));
  });

  it("gives two unplaceable callers the same count, whatever they send", () => {
    expect(from({ "x-forwarded-for": "a, b" })).toBe(
      from({ "x-forwarded-for": "c, d" }),
    );
  });
});
