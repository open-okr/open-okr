import type { CallerAddressReading } from "@openokr/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authCallerAddress,
  callerAddress,
  RESOLVED_CALLER_HEADER,
  withResolvedCaller,
} from "../src/auth/caller-address.ts";

/**
 * Whose address a request is counted under (completeness review M-12,
 * docs/design/sign-in-rate-limit.md).
 *
 * | Property | What it stops |
 * |---|---|
 * | The entry `OPENOKR_TRUSTED_PROXY_HOPS` places from the right is the caller | A proxy that appends sending every caller into one shared limit |
 * | Anything left of it is ignored, because the caller wrote it | A caller escaping a limit by writing a new address on every request |
 * | Zero hops ignores the header | Trusting a header when no proxy stands behind it |
 * | Every caller that cannot be placed shares one count | An untrusted caller getting a fresh window each time |
 * | A private header the caller sent never survives | A caller choosing its own key |
 */

const from = (headers: Record<string, string>) =>
  callerAddress(new Headers(headers));

const withHops = (hops: string | undefined) => {
  if (hops === undefined) {
    vi.stubEnv("OPENOKR_TRUSTED_PROXY_HOPS", "");
  } else {
    vi.stubEnv("OPENOKR_TRUSTED_PROXY_HOPS", hops);
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the caller's address with the default of one proxy", () => {
  it("is the one address a proxy wrote into X-Forwarded-For", () => {
    withHops(undefined);
    expect(from({ "x-forwarded-for": "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("is the rightmost entry of a chain, which the nearest proxy wrote", () => {
    withHops("1");
    expect(from({ "x-forwarded-for": "203.0.113.9, 198.51.100.4" })).toBe(
      "198.51.100.4",
    );
  });

  it("gives two callers with different rightmost entries separate addresses", () => {
    withHops("1");
    const first = from({ "x-forwarded-for": "10.0.0.1, 198.51.100.4" });
    const second = from({ "x-forwarded-for": "10.0.0.1, 198.51.100.5" });
    expect(first).not.toBe(second);
  });

  it("is not changed by what the caller put to the left", () => {
    withHops("1");
    expect(from({ "x-forwarded-for": "1.1.1.1, 198.51.100.4" })).toBe(
      from({ "x-forwarded-for": "2.2.2.2, 198.51.100.4" }),
    );
  });

  it("falls back to X-Real-IP when there is no forwarded address", () => {
    withHops("1");
    expect(from({ "x-real-ip": "198.51.100.1" })).toBe("198.51.100.1");
  });

  it("does not trust a value that is not an address", () => {
    withHops("1");
    expect(from({ "x-forwarded-for": "anything-at-all" })).toBe(from({}));
  });

  it("treats a blank or invalid setting as the default of one", () => {
    withHops("many");
    expect(from({ "x-forwarded-for": "203.0.113.9, 198.51.100.4" })).toBe(
      "198.51.100.4",
    );
  });
});

describe("the caller's address with two proxies", () => {
  it("is the second entry from the right", () => {
    withHops("2");
    expect(from({ "x-forwarded-for": "203.0.113.9, 198.51.100.4" })).toBe(
      "203.0.113.9",
    );
  });

  it("is not resolved when a proxy did not write its entry", () => {
    withHops("2");
    expect(from({ "x-forwarded-for": "203.0.113.9" })).toBe(from({}));
  });

  it("ignores X-Real-IP, which names the inner proxy", () => {
    withHops("2");
    expect(from({ "x-real-ip": "198.51.100.1" })).toBe(from({}));
  });
});

describe("the caller's address with no proxy", () => {
  it("ignores both headers, so every caller shares one count", () => {
    withHops("0");
    const none = from({});
    expect(from({ "x-forwarded-for": "203.0.113.9" })).toBe(none);
    expect(from({ "x-real-ip": "203.0.113.9" })).toBe(none);
  });
});

describe("the address Better Auth is handed", () => {
  it("is set from the proxy chain and replaces whatever the caller sent", () => {
    withHops("1");
    const request = withResolvedCaller(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.9, 198.51.100.4",
          [RESOLVED_CALLER_HEADER]: "192.0.2.77",
        },
        body: "{}",
      }),
    );
    expect(request.headers.get(RESOLVED_CALLER_HEADER)).toBe("198.51.100.4");
    expect(authCallerAddress(request.headers)).toBe("198.51.100.4");
  });

  it("is removed when the caller cannot be placed", () => {
    withHops("0");
    const request = withResolvedCaller(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.9",
          [RESOLVED_CALLER_HEADER]: "192.0.2.77",
        },
        body: "{}",
      }),
    );
    expect(request.headers.has(RESOLVED_CALLER_HEADER)).toBe(false);
    expect(authCallerAddress(request.headers)).toBe(from({}));
  });

  it("keeps the request body readable", async () => {
    withHops("1");
    const request = withResolvedCaller(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ email: "a@example.com" }),
      }),
    );
    expect(await request.json()).toEqual({ email: "a@example.com" });
  });
});

// Plan 0.8.0 H2's two readings, kept beside the hop count (Akmal, 11 November
// 2026): the ranges or the header replace the default when one is set.
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

const fromReading = (
  headers: Record<string, string>,
  reading: CallerAddressReading,
) => callerAddress(new Headers(headers), reading);

/** What a caller the instance cannot place is counted under. */
const unresolvedFor = (reading: CallerAddressReading) =>
  fromReading({}, reading);

describe("the caller's address behind named proxies", () => {
  it("is the first hop outside the ranges, read from the right", () => {
    expect(
      fromReading(
        { "x-forwarded-for": "198.51.100.7, 172.70.1.2" },
        CLOUDFLARE,
      ),
    ).toBe("198.51.100.7");
  });

  it("never reaches an entry the caller wrote to the left", () => {
    expect(
      fromReading(
        { "x-forwarded-for": "203.0.113.66, 198.51.100.7, 172.70.1.2" },
        CLOUDFLARE,
      ),
    ).toBe("198.51.100.7");
  });

  it("is unresolved when every hop is trusted", () => {
    expect(
      fromReading({ "x-forwarded-for": "172.70.9.9, 172.70.1.2" }, CLOUDFLARE),
    ).toBe(unresolvedFor(CLOUDFLARE));
  });

  it("is unresolved when the hop it reaches carries a port", () => {
    expect(
      fromReading(
        { "x-forwarded-for": "198.51.100.7:51234, 172.70.1.2" },
        CLOUDFLARE,
      ),
    ).toBe(unresolvedFor(CLOUDFLARE));
  });

  it("folds an IPv6 caller to its /64, as every key does", () => {
    expect(
      fromReading(
        { "x-forwarded-for": "2001:db8:1:2::7, 2606:4700::1" },
        CLOUDFLARE,
      ),
    ).toBe("2001:0db8:0001:0002:0000:0000:0000:0000");
  });

  it("walks past a load balancer whose own address never appears", () => {
    const alb: CallerAddressReading = {
      mode: "trusted_proxies",
      trustedProxies: ["10.0.1.0/24"],
    };
    expect(
      fromReading({ "x-forwarded-for": "203.0.113.66, 198.51.100.7" }, alb),
    ).toBe("198.51.100.7");
  });

  it("skips a hop written as an IPv4-mapped IPv6 address", () => {
    const alb: CallerAddressReading = {
      mode: "trusted_proxies",
      trustedProxies: ["10.0.1.0/24"],
    };
    expect(
      fromReading({ "x-forwarded-for": "198.51.100.7, ::ffff:10.0.1.5" }, alb),
    ).toBe("198.51.100.7");
  });

  it("does not read X-Real-IP when the chain resolves nothing", () => {
    expect(
      fromReading(
        {
          "x-forwarded-for": "172.70.9.9, 172.70.1.2",
          "x-real-ip": "203.0.113.66",
        },
        CLOUDFLARE,
      ),
    ).toBe(unresolvedFor(CLOUDFLARE));
  });
});

describe("the caller's address from a CDN's own header", () => {
  it("is that header, whatever X-Forwarded-For says", () => {
    expect(
      fromReading(
        {
          "cf-connecting-ip": "198.51.100.7",
          "x-forwarded-for": "203.0.113.66",
        },
        HEADER,
      ),
    ).toBe("198.51.100.7");
  });

  it("is unresolved when the header is absent", () => {
    expect(fromReading({ "x-forwarded-for": "198.51.100.7" }, HEADER)).toBe(
      unresolvedFor(HEADER),
    );
  });

  it("is unresolved when the header holds more than one address", () => {
    expect(
      fromReading({ "cf-connecting-ip": "203.0.113.66, 198.51.100.7" }, HEADER),
    ).toBe(unresolvedFor(HEADER));
  });

  it("reads X-Real-IP only when it is the header named", () => {
    expect(
      fromReading(
        { "x-real-ip": "198.51.100.1" },
        { mode: "header", header: "x-real-ip" },
      ),
    ).toBe("198.51.100.1");
  });
});
