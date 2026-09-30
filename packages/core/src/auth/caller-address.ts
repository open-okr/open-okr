/**
 * The address a request came from (TECHNICAL-PLAN §8.2, completeness review
 * M-12).
 *
 * **One answer, shared with the sign-in lockout.** Better Auth already decides
 * whose address a sign-in attempt is counted under, from the headers this
 * instance tells it to trust. A door that has no token to count against, such
 * as starting a device login, registering an OAuth client or redeeming at the
 * token endpoint, asks the same function with the same configuration. Two
 * parsers of one header are two answers to "who is calling", and the weaker
 * one would be the limit.
 *
 * **What is trusted.** Every deployment target puts a reverse proxy in front of
 * the application, so the socket address is the proxy's and the caller's is in
 * a header. `X-Forwarded-For` is read first and `X-Real-IP` second, and each
 * only when it holds exactly one well-formed address. The shipped Caddy
 * replaces `X-Forwarded-For` with the address it saw, which is one value. A
 * chain of several is what a proxy that appends leaves behind, and its first
 * entry is whatever the caller chose to send, so a chain is not trusted.
 *
 * **What is not resolved shares one count.** A caller whose address cannot be
 * trusted is counted with every other such caller. That limits more than it
 * should on a misconfigured proxy, which is the safe direction to be wrong in.
 */
import { getIP } from "better-auth/api";

/**
 * The headers the caller's address is read from, in order.
 *
 * Handed to Better Auth as its own configuration by `createAuth`, so the
 * lockout and every other per-address limit read the same thing.
 */
export const CALLER_ADDRESS_HEADERS: readonly string[] = [
  "x-forwarded-for",
  "x-real-ip",
];

/**
 * The key for a caller whose address could not be trusted.
 *
 * Better Auth answers these with a shared bucket of its own. This is the same
 * idea under a name a person reading a rate-limit key would recognise.
 */
const UNRESOLVED_ADDRESS = "unresolved";

/**
 * The caller's address, as the sign-in lockout would count it.
 *
 * Better Auth answers `127.0.0.1` rather than nothing in development and test,
 * so a local instance with no proxy still has an address to count.
 */
export function callerAddress(headers: Headers): string {
  return (
    getIP(headers, {
      advanced: {
        ipAddress: { ipAddressHeaders: [...CALLER_ADDRESS_HEADERS] },
      },
    }) ?? UNRESOLVED_ADDRESS
  );
}
