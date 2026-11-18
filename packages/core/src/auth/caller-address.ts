/**
 * The address a request came from (TECHNICAL-PLAN §8.2, completeness review
 * M-12, docs/design/trusted-proxies.md, docs/design/sign-in-rate-limit.md).
 *
 * **One answer, shared with the sign-in lockout.** Better Auth decides whose
 * address a sign-in attempt is counted under, and a door that has no token to
 * count against, such as starting a device login, registering an OAuth client
 * or redeeming at the token endpoint, asks the same function. Two parsers of
 * one header are two answers to "who is calling", and the weaker one would be
 * the limit.
 *
 * **What is trusted** is the deployment's choice, from three variables that
 * `packages/config` parses, at most one of them set (Akmal, 11 November 2026,
 * combining the hardening batch's hop count with plan 0.8.0 H2):
 *
 * | Set | Read |
 * |---|---|
 * | Nothing, or `OPENOKR_TRUSTED_PROXY_HOPS` | The `X-Forwarded-For` entry that many places from the right, default 1, which is both shipped topologies. Each proxy appends what it saw, so that entry is the one the nearest trusted proxy wrote and everything left of it is whatever the caller sent. With `0` no header is read. `X-Real-IP` is read only when there is no `X-Forwarded-For` and exactly one proxy, where that proxy overwrote the caller's value |
 * | `OPENOKR_TRUSTED_PROXIES` | `X-Forwarded-For`, walked from the right. A hop inside a named range is skipped and the first one outside every range is the caller, for a chain whose length varies |
 * | `OPENOKR_CLIENT_ADDRESS_HEADER` | That header alone, only when it holds one address, such as Cloudflare's `CF-Connecting-IP`. Safe only when the origin refuses every request that did not come through the CDN |
 *
 * **What is not resolved shares one count.** A caller whose address cannot be
 * trusted is counted with every other such caller. That limits more than it
 * should on a misconfigured proxy, which is the safe direction to be wrong in,
 * and it is counted and shown so an operator can see it (trusted-proxies.md
 * D12).
 *
 * **Better Auth's own limiter cannot count hops**, only a list of trusted
 * networks. `withResolvedCaller` therefore resolves the address once, before
 * the request reaches Better Auth, and hands it over in a private header that
 * Better Auth is told to read and nothing else may set: the header is deleted
 * from every incoming request first.
 */
import {
  type CallerAddressReading,
  callerAddressReading,
} from "@openokr/config";
import { getIP } from "better-auth/api";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";

/** Where `withResolvedCaller` hands the decided address to Better Auth. */
export const RESOLVED_CALLER_HEADER = "x-openokr-caller";

/** Better Auth's `ipAddressHeaders`: the private header and nothing else. */
export const CALLER_ADDRESS_HEADERS: readonly string[] = [
  RESOLVED_CALLER_HEADER,
];

const UNRESOLVED_ADDRESS = "unresolved";

function ipOptions() {
  return {
    advanced: {
      ipAddress: { ipAddressHeaders: [...CALLER_ADDRESS_HEADERS] },
    },
  };
}

/**
 * The candidate as Better Auth would read it, so the address a limit counts
 * and the one Better Auth records are the same string: an IPv6 address is
 * normalised, and something that is not an address is no address.
 */
function validated(candidate: string | null | undefined): string | undefined {
  if (candidate === undefined || candidate === null || candidate === "") {
    return undefined;
  }
  const headers = new Headers({ [RESOLVED_CALLER_HEADER]: candidate });
  const resolved = getIP(headers, ipOptions());
  const none = getIP(new Headers(), ipOptions());
  if (resolved === null || (resolved === none && candidate !== resolved)) {
    return undefined;
  }
  return resolved;
}

function fromHops(headers: Headers, hops: number): string | undefined {
  if (hops === 0) {
    return undefined;
  }
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const entries = forwarded
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return entries.length >= hops
      ? validated(entries[entries.length - hops])
      : undefined;
  }
  return hops === 1 ? validated(headers.get("x-real-ip")) : undefined;
}

/** The caller the reading in force places, or nothing. */
function resolve(
  headers: Headers,
  reading: CallerAddressReading,
): string | undefined {
  switch (reading.mode) {
    case "proxy_hops":
      return fromHops(headers, reading.hops);
    case "trusted_proxies":
      return (
        getIP(headers, {
          advanced: {
            ipAddress: {
              ipAddressHeaders: ["x-forwarded-for"],
              trustedProxies: [...reading.trustedProxies],
            },
          },
        }) ?? undefined
      );
    case "header": {
      const value = headers.get(reading.header);
      // One address only: a list in a header meant to hold one is not an
      // answer.
      return value !== null && !value.includes(",")
        ? validated(value.trim())
        : undefined;
    }
  }
}

/** Set once a caller could not be placed, for Admin, General (D12). */
const UNRESOLVED_SEEN = Symbol.for("openokr.unresolvedCallerSeen");
const processState = globalThis as { [UNRESOLVED_SEEN]?: boolean };

function fallback(): string {
  return getIP(new Headers(), ipOptions()) ?? UNRESOLVED_ADDRESS;
}

/**
 * The caller's address, or `unresolved`. Every per-address limit outside
 * Better Auth asks this.
 */
export function callerAddress(
  headers: Headers,
  reading: CallerAddressReading = callerAddressReading(),
): string {
  const address = resolve(headers, reading);
  defaultMetrics().count(METRIC.callerAddressesTotal, {
    outcome: address === undefined ? "unresolved" : "resolved",
  });
  if (address === undefined) {
    processState[UNRESOLVED_SEEN] = true;
    return fallback();
  }
  return address;
}

/**
 * The address inside Better Auth's own hooks: the one `withResolvedCaller`
 * decided for a routed request, or the headers' own for a server-side
 * `auth.api` call, which skips the router.
 */
export function authCallerAddress(headers: Headers): string {
  const resolved = headers.get(RESOLVED_CALLER_HEADER);
  return resolved
    ? (validated(resolved) ?? fallback())
    : callerAddress(headers);
}

/**
 * The request Better Auth's router sees: any copy of the private header the
 * caller sent is gone, and the decided address is in it.
 */
export function withResolvedCaller(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(RESOLVED_CALLER_HEADER);
  const resolved = resolve(request.headers, callerAddressReading());
  if (resolved !== undefined) {
    headers.set(RESOLVED_CALLER_HEADER, resolved);
  }
  // The router's request may come from another realm (next dev), and the Request
  // constructor reads a private field of its input, so a copy is built from public properties.
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    // Node requires duplex for a streamed body. Not in the DOM lib types yet.
    duplex: "half",
  } as RequestInit);
}

/** Whether this process has met a caller it could not place (D12). */
export function unresolvedCallersSeen(): boolean {
  return processState[UNRESOLVED_SEEN] === true;
}

/** For tests: forget that a caller went unplaced. */
export function forgetUnresolvedCallers(): void {
  processState[UNRESOLVED_SEEN] = false;
}
