import type { CallerAddressReading } from "@openokr/config";
import { describe, expect, it } from "vitest";
import { callerAddress } from "../src/auth/caller-address.ts";

/**
 * Whose address a request is counted under (completeness review M-12,
 * docs/design/trusted-proxies.md §1.1, plan 0.8.0 H2).
 *
 * | Property | What it stops |
 * |---|---|
 * | One forwarded address is trusted, as the shipped proxy writes it | A limit that cannot tell two callers apart |
 * | A chain is walked from the right past the proxies named, and only then | A caller escaping a limit by writing a new address on every request |
 * | A CDN's own header is read alone when the operator names it | Every visitor behind a CDN sharing one count |
 * | `X-Real-IP` is never a fallback (Q1, answered B) | A caller behind a proxy that appends choosing their own address |
 * | Every caller that cannot be placed shares one count | An untrusted caller getting a fresh window each time |
 *
 * Better Auth answers `127.0.0.1` rather than nothing in development and
 * test, so "unresolved" reads here as the answer a request with no header at
 * all gets. A production process answers `unresolved` for both.
 */

const NOTHING: CallerAddressReading = { mode: "single_address" };

/** Cloudflare's published ranges, as the install guide shows them. */
const CLOUDFLARE: CallerAddressReading = {
  mode: "trusted_proxies",
  trustedProxies: [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
  ],
};

const HEADER: CallerAddressReading = {
  mode: "header",
  header: "cf-connecting-ip",
};

const from = (
  headers: Record<string, string>,
  reading: CallerAddressReading = NOTHING,
) => callerAddress(new Headers(headers), reading);

/** What a caller the instance cannot place is counted under. */
const unresolved = (reading: CallerAddressReading = NOTHING) =>
  from({}, reading);

describe("the caller's address with nothing set", () => {
  it("is the one address a proxy wrote into X-Forwarded-For", () => {
    expect(from({ "x-forwarded-for": "198.51.100.7" })).toBe("198.51.100.7");
  });

  it("does not trust the first entry of a chain, which the caller wrote", () => {
    const spoofed = from({ "x-forwarded-for": "203.0.113.66, 198.51.100.7" });
    expect(spoofed).not.toBe("203.0.113.66");
    expect(spoofed).toBe(unresolved());
  });

  it("does not fall back to X-Real-IP, which a caller can write (Q1)", () => {
    expect(
      from({
        "x-forwarded-for": "203.0.113.66, 198.51.100.7",
        "x-real-ip": "203.0.113.66",
      }),
    ).toBe(unresolved());
    expect(from({ "x-real-ip": "198.51.100.1" })).toBe(unresolved());
  });

  it("does not trust a value that is not an address", () => {
    expect(from({ "x-forwarded-for": "anything-at-all" })).toBe(unresolved());
  });

  it("gives two unplaceable callers the same count, whatever they send", () => {
    expect(from({ "x-forwarded-for": "a, b" })).toBe(
      from({ "x-forwarded-for": "c, d" }),
    );
  });
});

describe("the caller's address behind named proxies", () => {
  it("is the first hop outside the ranges, read from the right", () => {
    expect(
      from({ "x-forwarded-for": "198.51.100.7, 172.70.1.2" }, CLOUDFLARE),
    ).toBe("198.51.100.7");
  });

  it("never reaches an entry the caller wrote to the left", () => {
    expect(
      from(
        { "x-forwarded-for": "203.0.113.66, 198.51.100.7, 172.70.1.2" },
        CLOUDFLARE,
      ),
    ).toBe("198.51.100.7");
  });

  it("is unresolved when every hop is trusted", () => {
    expect(
      from({ "x-forwarded-for": "172.70.9.9, 172.70.1.2" }, CLOUDFLARE),
    ).toBe(unresolved(CLOUDFLARE));
  });

  it("is unresolved when the hop it reaches carries a port", () => {
    expect(
      from({ "x-forwarded-for": "198.51.100.7:51234, 172.70.1.2" }, CLOUDFLARE),
    ).toBe(unresolved(CLOUDFLARE));
  });

  it("folds an IPv6 caller to its /64, as every key does", () => {
    expect(
      from({ "x-forwarded-for": "2001:db8:1:2::7, 2606:4700::1" }, CLOUDFLARE),
    ).toBe("2001:0db8:0001:0002:0000:0000:0000:0000");
  });

  it("walks past a load balancer whose own address never appears", () => {
    const alb: CallerAddressReading = {
      mode: "trusted_proxies",
      trustedProxies: ["10.0.1.0/24"],
    };
    expect(from({ "x-forwarded-for": "203.0.113.66, 198.51.100.7" }, alb)).toBe(
      "198.51.100.7",
    );
  });

  it("skips a hop written as an IPv4-mapped IPv6 address", () => {
    const alb: CallerAddressReading = {
      mode: "trusted_proxies",
      trustedProxies: ["10.0.1.0/24"],
    };
    expect(
      from({ "x-forwarded-for": "198.51.100.7, ::ffff:10.0.1.5" }, alb),
    ).toBe("198.51.100.7");
  });

  it("does not read X-Real-IP when the chain resolves nothing", () => {
    expect(
      from(
        {
          "x-forwarded-for": "172.70.9.9, 172.70.1.2",
          "x-real-ip": "203.0.113.66",
        },
        CLOUDFLARE,
      ),
    ).toBe(unresolved(CLOUDFLARE));
  });
});

describe("the caller's address from a CDN's own header", () => {
  it("is that header, whatever X-Forwarded-For says", () => {
    expect(
      from(
        {
          "cf-connecting-ip": "198.51.100.7",
          "x-forwarded-for": "203.0.113.66",
        },
        HEADER,
      ),
    ).toBe("198.51.100.7");
  });

  it("is unresolved when the header is absent", () => {
    expect(from({ "x-forwarded-for": "198.51.100.7" }, HEADER)).toBe(
      unresolved(HEADER),
    );
  });

  it("is unresolved when the header holds more than one address", () => {
    expect(
      from({ "cf-connecting-ip": "203.0.113.66, 198.51.100.7" }, HEADER),
    ).toBe(unresolved(HEADER));
  });

  it("reads X-Real-IP only when it is the header named", () => {
    expect(
      from(
        { "x-real-ip": "198.51.100.1" },
        { mode: "header", header: "x-real-ip" },
      ),
    ).toBe("198.51.100.1");
  });
});
