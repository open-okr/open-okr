import {
  type CallerAddressReading,
  callerAddressReading,
} from "@openokr/config";
import { getIP } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import {
  callerAddress,
  withResolvedCaller,
} from "../src/auth/caller-address.ts";
import {
  METRIC,
  type MetricRecorder,
  NO_METRICS,
  setDefaultMetrics,
} from "../src/telemetry/recorder.ts";

/**
 * One configuration, two readers (docs/design/trusted-proxies.md D8).
 *
 * Better Auth's limiter and session row read the caller from the private
 * header `withResolvedCaller` writes; the sign-in hold, the 429 audit row and
 * the public doors read it through `callerAddress()`. Both come from the one
 * reading in force (the hop count by default, or the ranges, or the header),
 * so for any request the two must agree, and no entry the boot accepts may be
 * one that is quietly dropped.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  setDefaultMetrics(NO_METRICS);
});

describe("the reading, per setting", () => {
  it("counts one proxy when nothing is set", () => {
    expect(callerAddressReading({})).toEqual({ mode: "proxy_hops", hops: 1 });
  });

  it("counts the proxies the hop count names", () => {
    expect(callerAddressReading({ OPENOKR_TRUSTED_PROXY_HOPS: "2" })).toEqual({
      mode: "proxy_hops",
      hops: 2,
    });
  });

  it("walks X-Forwarded-For past the ranges named", () => {
    expect(
      callerAddressReading({ OPENOKR_TRUSTED_PROXIES: "10.0.1.0/24" }),
    ).toEqual({ mode: "trusted_proxies", trustedProxies: ["10.0.1.0/24"] });
  });

  it("reads the named header alone", () => {
    expect(
      callerAddressReading({
        OPENOKR_CLIENT_ADDRESS_HEADER: "CF-Connecting-IP",
      }),
    ).toEqual({ mode: "header", header: "cf-connecting-ip" });
  });

  it("refuses the hop count beside either of the others", () => {
    expect(() =>
      callerAddressReading({
        OPENOKR_TRUSTED_PROXY_HOPS: "2",
        OPENOKR_TRUSTED_PROXIES: "10.0.1.0/24",
      }),
    ).toThrow(/OPENOKR_TRUSTED_PROXY_HOPS/);
  });
});

/**
 * Every form the boot accepts. Each must be one Better Auth honours: a range
 * it dropped would turn that proxy into "the caller" without a word.
 */
const ACCEPTED = [
  "10.0.1.0/24",
  "10.0.0.0/8",
  "172.64.0.0/13",
  "0.0.0.0/1",
  "192.0.2.10",
  "198.51.100.0/024",
  "2606:4700::/32",
  "2a06:98c0::/29",
  "2001:DB8::/32",
  "2001:db8::1",
  "fe80::/10",
  "::1",
];

describe("every entry the boot accepts", () => {
  it.each(ACCEPTED)("%s is honoured by Better Auth", (entry) => {
    expect(callerAddressReading({ OPENOKR_TRUSTED_PROXIES: entry })).toEqual({
      mode: "trusted_proxies",
      trustedProxies: [entry],
    });
    // The entry's own address as the nearest hop, a caller outside it to its
    // left. Honoured means the hop is skipped and the caller is reached.
    const hop = entry.split("/")[0] as string;
    const resolved = callerAddress(
      new Headers({ "x-forwarded-for": `192.0.2.77, ${hop}` }),
      { mode: "trusted_proxies", trustedProxies: [entry] },
    );
    expect(resolved).toBe("192.0.2.77");
  });
});

const REQUESTS: readonly Record<string, string>[] = [
  {},
  { "x-forwarded-for": "198.51.100.7" },
  { "x-forwarded-for": "203.0.113.66, 198.51.100.7" },
  { "x-forwarded-for": "203.0.113.66, 198.51.100.7, 172.70.1.2" },
  { "x-forwarded-for": "172.70.9.9, 172.70.1.2" },
  { "x-forwarded-for": "198.51.100.7, 10.0.1.9" },
  { "x-real-ip": "203.0.113.66" },
  { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.66" },
  { "cf-connecting-ip": "203.0.113.66, 198.51.100.7" },
];

const SETTINGS: readonly [string, Record<string, string>][] = [
  ["nothing set", {}],
  ["two hops", { OPENOKR_TRUSTED_PROXY_HOPS: "2" }],
  ["ranges", { OPENOKR_TRUSTED_PROXIES: "172.64.0.0/13, 10.0.1.0/24" }],
  ["a header", { OPENOKR_CLIENT_ADDRESS_HEADER: "CF-Connecting-IP" }],
];

describe("Better Auth and callerAddress()", () => {
  it.each(SETTINGS)("agree on every request with %s", (_name, variables) => {
    for (const [name, value] of Object.entries(variables)) {
      vi.stubEnv(name, value);
    }
    const auth = createAuth({
      pool: {} as never,
      secret: "a-test-secret-of-sufficient-length-for-signing",
      baseUrl: "http://localhost:3000",
    });
    for (const request of REQUESTS) {
      const headers = new Headers(request);
      // Better Auth sees the request the router hands it, with the private
      // header written.
      const routed = withResolvedCaller(
        new Request("http://localhost:3000/api/auth/ok", { headers }),
      );
      expect(callerAddress(headers)).toBe(getIP(routed.headers, auth.options));
    }
  });
});

describe("what callerAddress() counts", () => {
  const counted: { name: string; labels?: Record<string, string> }[] = [];
  const recorder: MetricRecorder = {
    ...NO_METRICS,
    count(name, labels) {
      counted.push({ name, ...(labels ? { labels } : {}) });
    },
  };

  it("counts a placed caller as resolved", () => {
    counted.length = 0;
    setDefaultMetrics(recorder);
    callerAddress(new Headers({ "x-forwarded-for": "198.51.100.7" }), {
      mode: "proxy_hops",
      hops: 1,
    } satisfies CallerAddressReading);
    expect(counted).toEqual([
      {
        name: METRIC.callerAddressesTotal,
        labels: { outcome: "resolved" },
      },
    ]);
  });

  it("counts a caller Better Auth cannot place as unresolved, and remembers it", async () => {
    // A production process answers nothing for an unplaced caller, where
    // development and test answer 127.0.0.1, so Better Auth's reader is
    // stood in for to see what this process does with nothing.
    vi.resetModules();
    vi.doMock("better-auth/api", () => ({ getIP: () => null }));
    try {
      const fresh = await import("../src/auth/caller-address.ts");
      const recorderModule = await import("../src/telemetry/recorder.ts");
      counted.length = 0;
      recorderModule.setDefaultMetrics(recorder);
      fresh.forgetUnresolvedCallers();
      expect(fresh.unresolvedCallersSeen()).toBe(false);

      expect(
        fresh.callerAddress(
          new Headers({ "x-forwarded-for": "203.0.113.66, 198.51.100.7" }),
        ),
      ).toBe("unresolved");
      expect(counted).toEqual([
        {
          name: METRIC.callerAddressesTotal,
          labels: { outcome: "unresolved" },
        },
      ]);
      expect(fresh.unresolvedCallersSeen()).toBe(true);
      fresh.forgetUnresolvedCallers();
    } finally {
      vi.doUnmock("better-auth/api");
      vi.resetModules();
    }
  });
});
