/**
 * The rules every outbound fetch obeys (TECHNICAL-PLAN.md §11, P5-T08b).
 *
 * **Server-side request forgery is the whole reason this exists.** A URL somebody
 * else chose, fetched by a server that sits inside a private network, is a way to
 * read that network. The cloud metadata services are the sharpest example: a
 * plain GET of `169.254.169.254` on most hosting returns credentials, with no
 * authentication of any kind, because the service assumes only the instance
 * itself can reach it.
 *
 * **Four rules, and each one closes a different way around the others.**
 *
 * | Rule | What it stops |
 * |---|---|
 * | The literal host is checked | `http://127.0.0.1/admin` |
 * | Every resolved address is checked | `http://evil.test/` where the name resolves to `10.0.0.5` |
 * | No redirect is followed | A public address answering `302 http://169.254.169.254/` |
 * | Size and time are capped | A URL that streams forever, or answers a gigabyte |
 *
 * Checking the name alone is defeated by DNS. Checking the address alone is
 * defeated by a name that resolves differently the second time, which is why the
 * request is made against the address that was checked rather than re-resolved.
 * Following one redirect is enough to reach anything, which is why none are.
 *
 * **This is the port's own module rather than a driver**, because there is no
 * vendor here: it is the platform `fetch` with the rules a hostile URL requires.
 * The channel drivers call fixed provider hosts and do not need it; a client
 * metadata document is the first address a stranger chooses.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Why a URL was refused, in words the caller can show or log. */
export type OutboundRefusal =
  | "not_a_url"
  | "scheme_not_allowed"
  | "host_not_allowed"
  | "address_not_allowed"
  | "redirected"
  | "too_large"
  | "timed_out"
  | "unreachable";

export interface OutboundOptions {
  /** How long the whole request may take. */
  readonly timeoutMs?: number;
  /** How many bytes may be read before the body is abandoned. */
  readonly maxBytes?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Lets a test drive the guard without a network or a resolver.
   *
   * Both are injected rather than mocked globally, because a global mock in one
   * test file is a global mock in every file that runs after it in the same
   * worker.
   */
  readonly fetchImpl?: typeof fetch;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
}

export type OutboundResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly body: string;
      readonly contentType: string | null;
    }
  | {
      readonly ok: false;
      readonly refusal: OutboundRefusal;
      readonly detail: string;
    };

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 256 * 1024;

/**
 * Names that must never be fetched, whatever they resolve to.
 *
 * The literal check is not the real defence, since a name can point anywhere;
 * it is here so an obvious mistake is refused before a resolver is even asked.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/**
 * Whether this address is one a server must never be talked into reaching.
 *
 * Written out rather than pulled from a package, because the list is short, it
 * does not change, and a dependency here would be a dependency inside the one
 * function whose whole job is not to trust the outside.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isBlockedV4(address);
  }
  if (version === 6) {
    return isBlockedV6(address);
  }
  // Not an address at all, which means something upstream is wrong. Refuse.
  return true;
}

function isBlockedV4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // this network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, and reserved above it
  return false;
}

function isBlockedV6(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "::" || value === "::1") {
    return true; // unspecified and loopback
  }
  // An IPv4 address wearing an IPv6 hat reaches exactly the same host.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) {
    return isBlockedV4(mapped[1]);
  }
  if (value.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(value)) return true; // unique local
  if (value.startsWith("ff")) return true; // multicast
  return false;
}

/** The addresses a name points at, or an empty list when it points nowhere. */
async function resolveHost(host: string): Promise<readonly string[]> {
  try {
    const found = await lookup(host, { all: true, verbatim: true });
    return found.map((entry) => entry.address);
  } catch {
    return [];
  }
}

export interface CheckedUrl {
  readonly url: URL;
  /** Every address the host resolved to, all of them already allowed. */
  readonly addresses: readonly string[];
}

/**
 * Whether this URL may be fetched at all.
 *
 * Exposed on its own because a caller sometimes wants to validate a stored
 * address without fetching it, and because it is where every rule but the
 * redirect and the caps lives.
 */
export async function checkUrl(
  candidate: string,
  options: Pick<OutboundOptions, "resolve"> = {},
): Promise<
  | { readonly ok: true; readonly checked: CheckedUrl }
  | {
      readonly ok: false;
      readonly refusal: OutboundRefusal;
      readonly detail: string;
    }
> {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, refusal: "not_a_url", detail: "That is not a URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      ok: false,
      refusal: "scheme_not_allowed",
      detail: `${url.protocol} is not a scheme this product fetches.`,
    };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    return {
      ok: false,
      refusal: "host_not_allowed",
      detail: `${url.hostname} is not a host this product fetches.`,
    };
  }

  // A literal address skips the resolver entirely: there is nothing to resolve
  // and asking would only give a name server a say it should not have.
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      return {
        ok: false,
        refusal: "address_not_allowed",
        detail: `${host} is a private or reserved address.`,
      };
    }
    return { ok: true, checked: { url, addresses: [host] } };
  }

  const resolver = options.resolve ?? resolveHost;
  const addresses = await resolver(host);
  if (addresses.length === 0) {
    return {
      ok: false,
      refusal: "unreachable",
      detail: `${url.hostname} does not resolve.`,
    };
  }

  // **Every address, not the first one.** A name with one public and one
  // private answer is the whole trick, and a check that stops at the first
  // allowed address lets the connection pick the other one.
  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked) {
    return {
      ok: false,
      refusal: "address_not_allowed",
      detail: `${url.hostname} resolves to ${blocked}, which is private or reserved.`,
    };
  }

  return { ok: true, checked: { url, addresses } };
}

/**
 * Fetches a URL somebody else chose, under every rule above.
 *
 * Returns a refusal rather than throwing, because every caller has something
 * better to say than a stack trace: a registration screen names the address it
 * would not fetch.
 */
export async function outboundFetch(
  candidate: string,
  options: OutboundOptions = {},
): Promise<OutboundResult> {
  const checked = await checkUrl(candidate, options);
  if (!checked.ok) {
    return checked;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(checked.checked.url, {
      // **No redirect is followed, ever.** One hop is enough to reach anything
      // the checks above refused, and re-checking each hop would still lose to
      // a name that answers differently the second time.
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...options.headers,
      },
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        refusal: "redirected",
        detail: `${candidate} answered ${response.status}, and redirects are not followed.`,
      };
    }

    const declared = response.headers.get("content-length");
    if (declared && Number.parseInt(declared, 10) > maxBytes) {
      return {
        ok: false,
        refusal: "too_large",
        detail: `That document says it is ${declared} bytes, and the limit is ${maxBytes}.`,
      };
    }

    // Read with a cap rather than trusting the declared length, which a hostile
    // server is free to understate or omit.
    const body = await readCapped(response, maxBytes);
    if (body === null) {
      return {
        ok: false,
        refusal: "too_large",
        detail: `That document is larger than ${maxBytes} bytes.`,
      };
    }

    return {
      ok: true,
      status: response.status,
      body,
      contentType: response.headers.get("content-type"),
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        refusal: "timed_out",
        detail: `That address did not answer within ${timeoutMs}ms.`,
      };
    }
    return {
      ok: false,
      refusal: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The body, or null when it runs past the cap. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return Buffer.byteLength(text) > maxBytes ? null : text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > maxBytes) {
      // Cancelled rather than read to the end: the point of a cap is not to
      // read a gigabyte and then decide against it.
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
