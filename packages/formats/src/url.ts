/** This machine's own addresses, as `URL` writes their host. */
const isLoopback = (host: string): boolean =>
  host === "localhost" ||
  host === "[::1]" ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

/**
 * A web address this instance will call: whole, with a host, and on http or
 * https (guided-inputs §4.11). `secure` takes https only, which is what an
 * OpenID provider's endpoints must be: OAuth 2.0 requires TLS for the
 * authorisation and token endpoints (RFC 6749 §3.1 and §3.2).
 *
 * **Except on this machine.** Plain http to localhost never leaves the
 * host, so TLS protects nothing there, which is the same reason OAuth lets a
 * loopback redirect address be http (RFC 8252 §8.3). It keeps an identity
 * provider being tried out locally, a Keycloak on http://localhost:8080,
 * usable.
 *
 * Read with `new URL` rather than a pattern, because that is the parser the
 * call itself is made with, so an address accepted here is one it can reach.
 */
export function isWebUrl(
  value: string,
  options: { readonly secure?: boolean } = {},
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hostname === "") {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return (
    url.protocol === "http:" && (!options.secure || isLoopback(url.hostname))
  );
}
