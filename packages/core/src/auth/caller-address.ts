/**
 * The address a request came from (TECHNICAL-PLAN §8.2, completeness review
 * M-12, docs/design/trusted-proxies.md).
 *
 * **One answer, shared with the sign-in lockout.** Better Auth already decides
 * whose address a sign-in attempt is counted under, from the options this
 * instance hands it. A door that has no token to count against, such as
 * starting a device login, registering an OAuth client or redeeming at the
 * token endpoint, asks the same function with the same options. Two parsers
 * of one header are two answers to "who is calling", and the weaker one would
 * be the limit.
 *
 * **What is trusted** is the deployment's choice, from two variables that
 * `packages/config` parses (D1 to D7):
 *
 * | Set | Read |
 * |---|---|
 * | Nothing | `X-Forwarded-For`, only when it holds one address. The shipped Caddy replaces it with the one address it saw. A chain's first entry is whatever the caller sent, so a chain places nobody |
 * | `OPENOKR_TRUSTED_PROXIES` | `X-Forwarded-For`, walked from the right. A hop inside a named range is skipped and the first one outside every range is the caller, so the entries a caller can write are reached only past every proxy the operator named |
 * | `OPENOKR_CLIENT_ADDRESS_HEADER` | That header alone, only when it holds one address, such as Cloudflare's `CF-Connecting-IP`. Safe only when the origin refuses every request that did not come through the CDN |
 *
 * `X-Real-IP` is never a fallback (Q1, answered B on 11 November 2026). A
 * proxy that appends to `X-Forwarded-For` leaves it as the caller sent it, so
 * reading it let a caller choose their own address. A proxy that writes only
 * that header is named with `OPENOKR_CLIENT_ADDRESS_HEADER=x-real-ip`.
 *
 * **What is not resolved shares one count.** A caller whose address cannot be
 * trusted is counted with every other such caller. That limits more than it
 * should on a misconfigured proxy, which is the safe direction to be wrong in,
 * and it is counted and shown so an operator can see it (D12).
 */
import {
  type CallerAddressReading,
  callerAddressReading,
} from "@openokr/config";
import { getIP } from "better-auth/api";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";

/** Better Auth's `advanced.ipAddress` block, the part this decides. */
export interface CallerAddressOptions {
  ipAddressHeaders: string[];
  trustedProxies?: string[];
}

/**
 * The reading as Better Auth's own options (D8). `createAuth` hands Better
 * Auth this block and `callerAddress()` hands it to Better Auth's `getIP`, so
 * the limiter, the session row and every other count read the same thing.
 *
 * Derived from the environment where it is used rather than installed by a
 * boot step, because a route bundle can hold its own copy of a module.
 */
export function callerAddressOptions(
  reading: CallerAddressReading = callerAddressReading(),
): CallerAddressOptions {
  switch (reading.mode) {
    case "single_address":
      return { ipAddressHeaders: ["x-forwarded-for"] };
    case "trusted_proxies":
      return {
        ipAddressHeaders: ["x-forwarded-for"],
        trustedProxies: [...reading.trustedProxies],
      };
    case "header":
      return { ipAddressHeaders: [reading.header] };
  }
}

/**
 * The key for a caller whose address could not be trusted.
 *
 * Better Auth answers these with a shared bucket of its own. This is the same
 * idea under a name a person reading a rate-limit key would recognise.
 */
const UNRESOLVED_ADDRESS = "unresolved";

/**
 * Whether this process has met a caller it could not place (D12). On
 * `globalThis`, because the route that counts it and the page that shows it
 * can be different bundles with their own copy of this module.
 */
const UNRESOLVED_SEEN = Symbol.for("openokr.unresolvedCallerSeen");
const processState = globalThis as { [UNRESOLVED_SEEN]?: boolean };

/**
 * The caller's address, as the sign-in lockout would count it.
 *
 * Better Auth answers `127.0.0.1` rather than nothing in development and test,
 * so a local instance with no proxy still has an address to count. Only a
 * production process meets an unresolved caller.
 *
 * `reading` is for tests. Everything else reads the environment's.
 */
export function callerAddress(
  headers: Headers,
  reading?: CallerAddressReading,
): string {
  const address = getIP(headers, {
    advanced: { ipAddress: callerAddressOptions(reading) },
  });
  defaultMetrics().count(METRIC.callerAddressesTotal, {
    outcome: address === null ? "unresolved" : "resolved",
  });
  if (address === null) {
    processState[UNRESOLVED_SEEN] = true;
    return UNRESOLVED_ADDRESS;
  }
  return address;
}

/**
 * Whether any caller this process counted could not be placed since it
 * started (D12). A correct deployment never produces one, and changing either
 * variable means a restart, which also clears this.
 */
export function unresolvedCallersSeen(): boolean {
  return processState[UNRESOLVED_SEEN] === true;
}

/** Test seam. Never call this from application code. */
export function forgetUnresolvedCallers(): void {
  processState[UNRESOLVED_SEEN] = false;
}
