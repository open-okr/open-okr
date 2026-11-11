import { z } from "zod";
import { EnvironmentError } from "./environment-error.ts";

/**
 * Whose address a request is counted under (docs/design/trusted-proxies.md,
 * plan 0.8.0 H2).
 *
 * Two variables describe the network in front of the instance, which the
 * product cannot see for itself:
 *
 * | Set | Reading |
 * |---|---|
 * | Neither | `X-Forwarded-For`, believed only when it holds one address |
 * | `OPENOKR_TRUSTED_PROXIES` | `X-Forwarded-For`, walked from the right past the proxies named |
 * | `OPENOKR_CLIENT_ADDRESS_HEADER` | That header alone, when it holds one address |
 *
 * **One parser** (D8). The environment schema in `env.ts` and the running
 * reading below call the same functions, so what the boot accepts is what a
 * request is read with. `packages/core` turns the reading into Better Auth's
 * own options.
 *
 * Unlike most variables here, a refusal repeats the bad entry (D7). An address
 * range is not a secret, and an operator with twenty-two ranges needs to know
 * which one is wrong.
 */

const TRUSTED_PROXIES_VARIABLE = "OPENOKR_TRUSTED_PROXIES";
export const TRUSTED_PROXY_HOPS_VARIABLE = "OPENOKR_TRUSTED_PROXY_HOPS";
export const CLIENT_ADDRESS_HEADER_VARIABLE = "OPENOKR_CLIENT_ADDRESS_HEADER";

export type CallerAddressReading =
  /**
   * The default: the `X-Forwarded-For` entry that many places from the right,
   * because the rightmost is the one the nearest proxy wrote (the hardening
   * batch's hop count, default 1). Zero reads no header at all.
   */
  | { readonly mode: "proxy_hops"; readonly hops: number }
  | {
      readonly mode: "trusted_proxies";
      readonly trustedProxies: readonly string[];
    }
  | { readonly mode: "header"; readonly header: string };

interface CallerAddressProblem {
  readonly variable: string;
  readonly message: string;
}

// Zod's own address checks, which are the ones Better Auth uses to read a
// range, so an entry this accepts is one Better Auth honours.
const IPV4 = z.ipv4();
const IPV6 = z.ipv6();
const isIPv4 = (value: string) => IPV4.safeParse(value).success;
const isIPv6 = (value: string) => IPV6.safeParse(value).success;

/** The eight 16-bit groups of an IPv6 address, a dotted tail included. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [left = "", right] = text.split("::");
  const head = left === "" ? [] : left.split(":");
  const tail = right === undefined || right === "" ? [] : right.split(":");
  const missing = right === undefined ? 0 : 8 - head.length - tail.length;
  return [...head, ...Array<string>(missing).fill("0"), ...tail].map((group) =>
    Number.parseInt(group, 16),
  );
}

/**
 * `::ffff:10.0.0.1` in any spelling. Better Auth reads these as IPv4, so a
 * range written this way gets an IPv4 prefix length it was never meant to
 * have, and is dropped. Written as IPv4 it means what it says.
 */
function isIPv4Mapped(address: string): boolean {
  const groups = ipv6Groups(address);
  return (
    groups.length === 8 &&
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff
  );
}

/** Why one entry cannot be trusted as a proxy, or null when it can. */
function entryProblem(entry: string): string | null {
  const slash = entry.lastIndexOf("/");
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const prefix = slash === -1 ? undefined : entry.slice(slash + 1);
  const v4 = isIPv4(address);
  const v6 = !v4 && isIPv6(address);
  const notARange = `\`${entry}\` is not an IP address or a CIDR range such as 10.0.1.0/24. Host names are not read`;
  if (!v4 && !v6) {
    return notARange;
  }
  if (v6 && isIPv4Mapped(address)) {
    return `\`${entry}\` is an IPv4 address written as IPv6. Write it as IPv4, such as 10.0.0.0/8`;
  }
  if (prefix !== undefined) {
    if (!/^\d+$/.test(prefix) || Number(prefix) > (v4 ? 32 : 128)) {
      return notARange;
    }
    if (Number(prefix) === 0) {
      return `\`${entry}\` trusts every address, which would let every caller choose their own. Name your proxies' own addresses`;
    }
  }
  return null;
}

/**
 * The entries of `OPENOKR_TRUSTED_PROXIES`, separated by commas, spaces or
 * newlines, and what is wrong with each one that is wrong (D6, D7).
 */
export function parseTrustedProxies(raw: string): {
  readonly entries: readonly string[];
  readonly problems: readonly string[];
} {
  const entries = raw.split(/[\s,]+/).filter((entry) => entry !== "");
  const problems = entries.flatMap((entry) => {
    const problem = entryProblem(entry);
    return problem === null ? [] : [problem];
  });
  return { entries, problems };
}

/** RFC 9110's token: the characters a header name may hold. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** `OPENOKR_CLIENT_ADDRESS_HEADER`, in lower case, or why it cannot be one. */
export function parseClientAddressHeader(raw: string): {
  readonly header?: string;
  readonly problem?: string;
} {
  const header = raw.trim().toLowerCase();
  if (!HEADER_NAME.test(header)) {
    return {
      problem: `\`${raw.trim()}\` is not an HTTP header name, such as cf-connecting-ip`,
    };
  }
  if (header === "x-forwarded-for") {
    return {
      problem: `names X-Forwarded-For, which is a chain rather than one address. Name the proxies in front of the instance in ${TRUSTED_PROXIES_VARIABLE} instead`,
    };
  }
  return { header };
}

/** The sentence for both set, shared by the schema and the reading (D5). */
export const HOPS_WITH_ANOTHER_PROBLEM = `cannot be set together with ${TRUSTED_PROXIES_VARIABLE} or OPENOKR_CLIENT_ADDRESS_HEADER. Set one: the hop count is the default reading, and the ranges or the header replace it`;

/** The hop count as `env.ts` reads it: a whole number from 0 to 10, default 1. */
function hopsFrom(raw: string | undefined): number {
  if (raw === undefined) {
    return 1;
  }
  const value = Number(raw.trim());
  return Number.isInteger(value) && value >= 0 && value <= 10 ? value : 1;
}

export const BOTH_SET_PROBLEM = `cannot be set together with ${TRUSTED_PROXIES_VARIABLE}. Set one: the ranges name the proxies in front of the instance, the header names the one your CDN writes`;

/** A variable's value, with blank read as unset, as `env.ts` reads every one. */
function variableValue(
  source: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = source[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The reading the two variables give, and every problem with them. */
function readCallerAddressSettings(source: Readonly<Record<string, unknown>>): {
  readonly reading: CallerAddressReading;
  readonly problems: readonly CallerAddressProblem[];
} {
  const problems: CallerAddressProblem[] = [];
  const rawProxies = variableValue(source, TRUSTED_PROXIES_VARIABLE);
  const rawHeader = variableValue(source, CLIENT_ADDRESS_HEADER_VARIABLE);
  const rawHops = variableValue(source, TRUSTED_PROXY_HOPS_VARIABLE);

  const proxies =
    rawProxies === undefined ? undefined : parseTrustedProxies(rawProxies);
  for (const message of proxies?.problems ?? []) {
    problems.push({ variable: TRUSTED_PROXIES_VARIABLE, message });
  }
  const header =
    rawHeader === undefined ? undefined : parseClientAddressHeader(rawHeader);
  if (header?.problem !== undefined) {
    problems.push({
      variable: CLIENT_ADDRESS_HEADER_VARIABLE,
      message: header.problem,
    });
  }
  const ranges = proxies?.entries ?? [];
  if (ranges.length > 0 && header !== undefined) {
    problems.push({
      variable: CLIENT_ADDRESS_HEADER_VARIABLE,
      message: BOTH_SET_PROBLEM,
    });
  }
  if (rawHops !== undefined && (ranges.length > 0 || header !== undefined)) {
    problems.push({
      variable: TRUSTED_PROXY_HOPS_VARIABLE,
      message: HOPS_WITH_ANOTHER_PROBLEM,
    });
  }

  if (header?.header !== undefined) {
    return { reading: { mode: "header", header: header.header }, problems };
  }
  if (ranges.length > 0) {
    return {
      reading: { mode: "trusted_proxies", trustedProxies: ranges },
      problems,
    };
  }
  return { reading: { mode: "proxy_hops", hops: hopsFrom(rawHops) }, problems };
}

/**
 * The cache is keyed on the two raw values, so a test or a process that
 * changes them is read again, and a request never parses twenty-two ranges.
 * On `globalThis` because a route bundle can hold its own copy of this module.
 */
const CACHE_KEY = Symbol.for("openokr.callerAddressReading");
const cacheHolder = globalThis as {
  [CACHE_KEY]?: { key: string; reading: CallerAddressReading };
};

/**
 * The reading in force, from the environment (D8). Throws the boot's own
 * refusal when the variables are malformed, which a running server never
 * meets, because `loadEnv` refused it first.
 */
export function callerAddressReading(
  source: Readonly<Record<string, unknown>> = process.env,
): CallerAddressReading {
  const key = `${variableValue(source, TRUSTED_PROXIES_VARIABLE) ?? ""}\u0000${variableValue(source, CLIENT_ADDRESS_HEADER_VARIABLE) ?? ""}\u0000${variableValue(source, TRUSTED_PROXY_HOPS_VARIABLE) ?? ""}`;
  const cached = cacheHolder[CACHE_KEY];
  if (cached?.key === key) {
    return cached.reading;
  }
  const { reading, problems } = readCallerAddressSettings(source);
  if (problems.length > 0) {
    throw new EnvironmentError(
      [...new Set(problems.map((problem) => problem.variable))],
      [
        `Invalid environment. ${problems.length} variable${problems.length === 1 ? "" : "s"} to fix:`,
        ...problems.map(
          (problem) => `  ${problem.variable}: ${problem.message}`,
        ),
        "",
      ].join("\n"),
    );
  }
  cacheHolder[CACHE_KEY] = { key, reading };
  return reading;
}

/** The boot log line (D10). Never anything secret: none of this is. */
export function describeCallerAddressReading(
  reading: CallerAddressReading,
): string {
  switch (reading.mode) {
    case "proxy_hops":
      return reading.hops === 0
        ? "caller address: no proxy named, so no header is read"
        : `caller address: X-Forwarded-For, ${reading.hops} ${reading.hops === 1 ? "proxy" : "proxies"} from the right`;
    case "trusted_proxies": {
      const count = reading.trustedProxies.length;
      return `caller address: X-Forwarded-For, trusting ${count} ${count === 1 ? "range" : "ranges"}`;
    }
    case "header":
      return `caller address: the ${reading.header} header only`;
  }
}
