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
 * request is made against the address that was checked rather than re-resolved:
 * the default transport (`createPinnedFetch`) connects only to the addresses
 * `checkUrl` approved, and keeps the hostname for the Host header and TLS.
 * Following one redirect is enough to reach anything, which is why none are.
 *
 * **This is the port's own module rather than a driver**, because there is no
 * vendor here: it is the platform `fetch` with the rules a hostile URL requires.
 * The channel drivers call fixed provider hosts and do not need it; a client
 * metadata document is the first address a stranger chooses.
 */
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

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
  /** GET unless told otherwise. A webhook is a POST with a JSON body. */
  readonly method?: "GET" | "POST";
  readonly body?: string;
  /**
   * Read at most `maxBytes` of the answer and keep going, rather than refusing
   * a longer one. For a caller that discards the body anyway: a webhook
   * receiver that answers 200 with a large page has still taken the delivery.
   */
  readonly truncate?: boolean;
  /**
   * Lets the address be inside the network: private ranges, loopback and
   * `localhost` (docs/design/outbound-webhooks.md Q1). The cloud metadata
   * addresses and names stay refused whatever this says, because the one
   * thing no deployment means to send a request to is its own credentials.
   */
  readonly allowPrivate?: boolean;
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
const METADATA_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);
const BLOCKED_HOSTNAMES = new Set(["localhost", ...METADATA_HOSTNAMES]);

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

/**
 * Whether this address is a cloud metadata service, which stays refused even
 * where private addresses are allowed (outbound-webhooks.md Q1).
 *
 * IPv4 link-local holds the common one, `169.254.169.254`, and every other
 * provider's on the same block; Alibaba's sits in carrier-grade NAT space; and
 * AWS has an IPv6 one inside the unique-local block. IPv6 link-local goes with
 * them, because nothing on it is a webhook receiver. An address that does not
 * parse is refused, as it is everywhere here.
 */
function isMetadataAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return isMetadataV4(address);
  }
  if (version !== 6) {
    return true;
  }
  const h = expandV6(address);
  if (!h) return true;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const v4 = (high: number, low: number): boolean =>
    isMetadataV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  const firstFiveZero =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
  if (firstFiveZero && (h5 === 0xffff || h5 === 0)) return v4(h6, h7);
  if (
    h0 === 0x64 &&
    h1 === 0xff9b &&
    h2 === 0 &&
    h3 === 0 &&
    h4 === 0 &&
    h5 === 0
  )
    return v4(h6, h7); // NAT64
  if (h0 === 0x2002) return v4(h1, h2); // 6to4
  if ((h0 & 0xffc0) === 0xfe80) return true; // link-local
  // AWS's IPv6 instance metadata service, fd00:ec2::254.
  return (
    h0 === 0xfd00 &&
    h1 === 0x0ec2 &&
    h2 === 0 &&
    h3 === 0 &&
    h4 === 0 &&
    h5 === 0 &&
    h6 === 0 &&
    h7 === 0x254
  );
}

function isMetadataV4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  if (a === 169 && b === 254) return true; // link-local, every big cloud's
  return a === 100 && b === 100 && c === 100 && d === 200; // Alibaba Cloud
}

/** Expands an IPv6 literal to its eight hextets, or null when it is not one. */
function expandV6(address: string): number[] | null {
  // A zone id ("%eth0") names an interface, not a host.
  let value = address.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  // A dotted IPv4 tail stands for the last two hextets.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (tail) {
    const octets = tail.slice(1, 5).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const [a, b, c, d] = octets as [number, number, number, number];
    value = `${value.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parse = (text: string): string[] =>
    text === "" ? [] : text.split(":");
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ];
  const hextets = groups.map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );
  return hextets.length === 8 && hextets.every((h) => !Number.isNaN(h))
    ? hextets
    : null;
}

function isBlockedV6(address: string): boolean {
  const h = expandV6(address);
  // Not parseable means something upstream is wrong. Refuse.
  if (!h) return true;
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  // Embedded forms reach the same host as the IPv4 address they carry, so the
  // IPv4 rules decide. The last 32 bits are h6 and h7.
  const v4 = (high: number, low: number): boolean =>
    isBlockedV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  const firstFiveZero =
    h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;

  if (firstFiveZero && h5 === 0 && h6 === 0 && h7 <= 1) return true; // unspecified and loopback
  if (firstFiveZero && h5 === 0xffff) return v4(h6, h7); // IPv4-mapped
  if (firstFiveZero && h5 === 0) return v4(h6, h7); // IPv4-compatible
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0xffff && h5 === 0)
    return v4(h6, h7); // IPv4-translated
  if (
    h0 === 0x64 &&
    h1 === 0xff9b &&
    h2 === 0 &&
    h3 === 0 &&
    h4 === 0 &&
    h5 === 0
  )
    return v4(h6, h7); // NAT64
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return true; // local-use NAT64
  if (h0 === 0x2002) return v4(h1, h2); // 6to4 carries the IPv4 address in bits 16 to 47
  if (h0 === 0x2001 && h1 === 0) return true; // Teredo
  if (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) return true; // discard-only
  if (h0 === 0x2001 && h1 === 0xdb8) return true; // documentation
  if ((h0 & 0xffc0) === 0xfe80) return true; // link-local, fe80::/10
  if ((h0 & 0xffc0) === 0xfec0) return true; // deprecated site-local, fec0::/10
  if ((h0 & 0xfe00) === 0xfc00) return true; // unique local, fc00::/7
  if ((h0 & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * A `lookup` for `http.request` that answers only with addresses already
 * checked, whatever name it is asked about.
 *
 * Node's runtime `fetch` resolves the name again when it connects, so a name
 * that answers public for the check and private for the connection would get
 * past a check made beforehand. Taking the resolver out of the connection
 * closes that gap. Exposed for the test that proves it.
 */
export function pinnedLookup(addresses: readonly string[]) {
  const entries = addresses.map((address) => ({
    address,
    family: isIP(address) === 6 ? 6 : 4,
  }));
  return (
    _hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (
      error: Error | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ): void => {
    const first = entries[0];
    if (!first) {
      callback(new Error("No checked address to connect to."), "", 4);
      return;
    }
    if (typeof options === "object" && options?.all) {
      callback(null, entries);
      return;
    }
    callback(null, first.address, first.family);
  };
}

/**
 * A `fetch` that connects only to `addresses`, which the caller has already
 * checked, and sends the original hostname as the Host header and the TLS
 * server name. No redirect is followed and every connection is new, so no
 * socket from an earlier request is reused.
 *
 * Built on `node:http` and `node:https`, because the bundled `undici` is not a
 * package this repository may import and a new dependency here is the thing
 * the guard least wants. The body of a request is buffered, which is right for
 * the small JSON bodies this guard carries; the answer streams.
 */
function createPinnedFetch(addresses: readonly string[]): typeof fetch {
  const lookupChecked = pinnedLookup(addresses);
  return async (input, init) => {
    const request = new Request(input as string | URL | Request, init);
    const url = new URL(request.url);
    const transport = url.protocol === "https:" ? https : http;
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? null
        : Buffer.from(await request.arrayBuffer());
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    if (body && !headers["content-length"]) {
      headers["content-length"] = String(body.length);
    }

    return new Promise<Response>((resolve, reject) => {
      const outgoing = transport.request(
        {
          hostname: url.hostname.replace(/^\[|\]$/g, ""),
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: request.method,
          headers,
          agent: false,
          lookup: lookupChecked as never,
          signal: request.signal,
        },
        (incoming) => {
          const answer = new Headers();
          for (let i = 0; i + 1 < incoming.rawHeaders.length; i += 2) {
            answer.append(
              incoming.rawHeaders[i] as string,
              incoming.rawHeaders[i + 1] as string,
            );
          }
          const status = incoming.statusCode ?? 200;
          const bodyless = status === 204 || status === 205 || status === 304;
          if (bodyless) {
            incoming.resume();
          }
          resolve(
            new Response(
              bodyless
                ? null
                : (Readable.toWeb(incoming) as unknown as ReadableStream),
              {
                status,
                ...(incoming.statusMessage
                  ? { statusText: incoming.statusMessage }
                  : {}),
                headers: answer,
              },
            ),
          );
        },
      );
      outgoing.on("error", reject);
      outgoing.end(body ?? undefined);
    });
  };
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
  options: Pick<OutboundOptions, "resolve" | "allowPrivate"> = {},
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
  const allowPrivate = options.allowPrivate === true;
  const refused = allowPrivate ? isMetadataAddress : isBlockedAddress;
  if ((allowPrivate ? METADATA_HOSTNAMES : BLOCKED_HOSTNAMES).has(host)) {
    return {
      ok: false,
      refusal: "host_not_allowed",
      detail: `${url.hostname} is not a host this product fetches.`,
    };
  }

  // A literal address skips the resolver entirely: there is nothing to resolve
  // and asking would only give a name server a say it should not have.
  if (isIP(host) !== 0) {
    if (refused(host)) {
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
  const blocked = addresses.find((address) => refused(address));
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
  const doFetch =
    options.fetchImpl ?? createPinnedFetch(checked.checked.addresses);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(checked.checked.url, {
      method: options.method ?? "GET",
      ...(options.body === undefined ? {} : { body: options.body }),
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
    if (
      !options.truncate &&
      declared &&
      Number.parseInt(declared, 10) > maxBytes
    ) {
      return {
        ok: false,
        refusal: "too_large",
        detail: `That document says it is ${declared} bytes, and the limit is ${maxBytes}.`,
      };
    }

    // Read with a cap rather than trusting the declared length, which a hostile
    // server is free to understate or omit.
    const body = await readCapped(
      response,
      maxBytes,
      options.truncate === true,
    );
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

/**
 * The body, or null when it runs past the cap. With `truncate`, the first
 * `maxBytes` of it instead, and the rest is never read.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
  truncate = false,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) <= maxBytes) {
      return text;
    }
    return truncate
      ? Buffer.from(text).subarray(0, maxBytes).toString("utf8")
      : null;
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
      if (!truncate) {
        return null;
      }
      chunks.push(value.subarray(0, value.length - (total - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Thrown by `guardedFetch` when an address is refused. */
export class OutboundRefusedError extends Error {
  readonly refusal: OutboundRefusal;

  constructor(refusal: OutboundRefusal, detail: string) {
    super(detail);
    this.name = "OutboundRefusedError";
    this.refusal = refusal;
  }
}

/**
 * A `fetch` that refuses what `outboundFetch` refuses, and streams the rest
 * (completeness review H-07).
 *
 * `outboundFetch` reads a whole body under a size cap, which is right for a
 * discovery document and wrong for a model's answer, which streams and can
 * run long. This is the same address check and the same refusal of every
 * redirect, handed to a provider SDK as its `fetch`: every request that SDK
 * makes is checked before it leaves, including the ones it builds from a
 * base URL an administrator typed.
 *
 * Used for the two drivers that take an address, Ollama and any
 * OpenAI-compatible endpoint, when the instance is the managed cloud. There a
 * workspace administrator is not the operator, and a base URL pointed at
 * `169.254.169.254` or the database host is a request the server would make
 * on their behalf. On a self-hosted instance a private address is the point:
 * that is where a local model runs.
 */
export function createGuardedFetch(
  options: Pick<OutboundOptions, "fetchImpl" | "resolve" | "allowPrivate"> = {},
): typeof fetch {
  return async (input, init) => {
    const candidate =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const checked = await checkUrl(candidate, options);
    if (!checked.ok) {
      throw new OutboundRefusedError(checked.refusal, checked.detail);
    }
    const doFetch =
      options.fetchImpl ?? createPinnedFetch(checked.checked.addresses);
    const response = await doFetch(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      throw new OutboundRefusedError(
        "redirected",
        `${candidate} answered ${response.status}, and redirects are not followed.`,
      );
    }
    return response;
  };
}
