/**
 * The address a request came from (TECHNICAL-PLAN §8.2, completeness review
 * M-12, docs/design/sign-in-rate-limit.md).
 *
 * **One answer, shared with the sign-in lockout.** Better Auth decides whose
 * address a sign-in attempt is counted under, and a door that has no token to
 * count against, such as starting a device login, registering an OAuth client
 * or redeeming at the token endpoint, asks the same function. Two parsers of
 * one header are two answers to "who is calling", and the weaker one would be
 * the limit.
 *
 * **What is trusted: a number of proxies, not a guess.** Every deployment
 * target puts reverse proxies in front of the application, so the socket
 * address is a proxy's and the caller's is in `X-Forwarded-For`. Each proxy
 * appends the address it saw, so the entry `OPENOKR_TRUSTED_PROXY_HOPS` places
 * from the right is the one the nearest trusted proxy wrote, and everything to
 * its left is whatever the caller chose to send. The default is one proxy,
 * which is both shipped topologies. With `0` the header is ignored.
 * `X-Real-IP` is read only when there is no `X-Forwarded-For` and exactly one
 * proxy: a single proxy that sets it overwrites the caller's value, while with
 * more hops it names the inner proxy and with none the caller wrote it.
 *
 * **What is not resolved shares one count.** A caller whose address cannot be
 * trusted (no header, fewer entries than proxies, an entry that is not an
 * address) is counted with every other such caller. That limits more than it
 * should on a misconfigured proxy, which is the safe direction to be wrong in.
 *
 * **Better Auth's own limiter cannot count hops**, only a list of trusted
 * networks. `withResolvedCaller` therefore resolves the address once, before
 * the request reaches Better Auth, and hands it over in a private header that
 * Better Auth is told to read. The header is always set or removed there, so a
 * value the caller sent never survives.
 */
import { trustedProxyHops } from "@openokr/config";
import { getIP } from "better-auth/api";

/**
 * The private header carrying the resolved address into Better Auth. Never
 * read from a request that did not pass through `withResolvedCaller`.
 */
export const RESOLVED_CALLER_HEADER = "x-openokr-caller";

/**
 * The headers Better Auth reads the caller's address from: only the private
 * one, so its limiter and every hook see what `callerAddress` decided.
 */
export const CALLER_ADDRESS_HEADERS: readonly string[] = [
  RESOLVED_CALLER_HEADER,
];

/**
 * The key for a caller whose address could not be trusted.
 *
 * Better Auth answers these with a shared bucket of its own. This is the same
 * idea under a name a person reading a rate-limit key would recognise.
 */
const UNRESOLVED_ADDRESS = "unresolved";

/** Normalises one candidate through Better Auth's own validation (IPv6 to /64). */
function validated(candidate: string | undefined): string | undefined {
  if (candidate === undefined || candidate === "") {
    return undefined;
  }
  const headers = new Headers({ [RESOLVED_CALLER_HEADER]: candidate });
  // Better Auth answers 127.0.0.1 for a bad value in development and test, so
  // a value that is not an address is told apart by asking twice.
  const resolved = getIP(headers, ipOptions());
  const none = getIP(new Headers(), ipOptions());
  if (resolved === null || (resolved === none && candidate !== resolved)) {
    return undefined;
  }
  return resolved;
}

function ipOptions() {
  return {
    advanced: {
      ipAddress: { ipAddressHeaders: [...CALLER_ADDRESS_HEADERS] },
    },
  };
}

/** The address the configured number of proxies vouches for, or undefined. */
function fromProxyChain(headers: Headers): string | undefined {
  const hops = trustedProxyHops();
  if (hops === 0) {
    return undefined;
  }
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const entries = forwarded
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Fewer entries than proxies means a proxy did not write one, so the
    // rightmost is not the one this setting counts on.
    return entries.length >= hops
      ? validated(entries[entries.length - hops])
      : undefined;
  }
  return hops === 1
    ? validated(headers.get("x-real-ip") ?? undefined)
    : undefined;
}

/**
 * The caller's address from the request's own headers, as every limit counts
 * it. Used by the doors that run outside Better Auth.
 */
export function callerAddress(headers: Headers): string {
  return fromProxyChain(headers) ?? fallback();
}

/**
 * The address inside Better Auth's hooks, which see the request after
 * `withResolvedCaller`. A call with no private header, such as a server-side
 * `auth.api` call, resolves from the proxy headers like any other door.
 */
export function authCallerAddress(headers: Headers): string {
  const resolved = headers.get(RESOLVED_CALLER_HEADER);
  return resolved
    ? (validated(resolved) ?? fallback())
    : callerAddress(headers);
}

/**
 * Better Auth answers `127.0.0.1` rather than nothing in development and test,
 * so a local instance with no proxy still has an address to count.
 */
function fallback(): string {
  return getIP(new Headers(), ipOptions()) ?? UNRESOLVED_ADDRESS;
}

/**
 * The request with its caller resolved once, for Better Auth's handler.
 *
 * Whatever private header the caller sent is replaced or removed, so only this
 * function can write it.
 */
export function withResolvedCaller(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(RESOLVED_CALLER_HEADER);
  const resolved = fromProxyChain(request.headers);
  if (resolved !== undefined) {
    headers.set(RESOLVED_CALLER_HEADER, resolved);
  }
  return new Request(request, { headers });
}
