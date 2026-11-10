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
