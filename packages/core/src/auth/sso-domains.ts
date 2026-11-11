/**
 * Proving that a workspace owns an email domain (docs/design/
 * sso-domain-verification.md).
 *
 * A workspace proves a domain by publishing a DNS TXT record that only the
 * domain's owner can add. The record is `openokr-verify=<token>` at
 * `_openokr-verify.<domain>`. The token is 32 random bytes, shown to the
 * administrator once, and only its SHA-256 is stored.
 *
 * Pure helpers and the pre-tenant read live here. The writes are in
 * `actions/sso-domains.ts` and `operator/domains.ts`, through the Operation
 * pipeline, and the daily re-check is in `auth/sso-domain-recheck.ts`.
 *
 * **Verification gates two things and not a third.** `enforce` can be turned
 * on only for verified domains (rule 3), and a new password sign-up on a
 * verified, enforced domain is refused (rule 4). Refusing a *member's* local
 * sign-in does not need it: connections that already enforced before this
 * existed keep doing so (decision 2 of the design).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { withSSOLookup } from "@openokr/db";
import { isDomain } from "@openokr/formats";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { SSOConnectionRejected } from "./sso.ts";

/** The label the record lives under, in front of the domain. */
export const DOMAIN_RECORD_LABEL = "_openokr-verify";
/** What the record's value starts with. */
export const DOMAIN_RECORD_PREFIX = "openokr-verify=";
/**
 * Failed daily checks in a row before a verified domain is unverified. Three
 * is about three days, so a DNS change in progress does not flap.
 */
export const DOMAIN_FAILURE_LIMIT = 3;

/**
 * The resolver a host hands an action: the one method the check needs, so
 * `packages/core` does not depend on `packages/adapters` and the driver
 * satisfies it structurally.
 */
export interface DomainResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

/** A domain as stored: trimmed, lower-cased, and shaped like one. */
export function normaliseDomain(input: string): string | null {
  const domain = input.trim().toLowerCase();
  return isDomain(domain) ? domain : null;
}

export function newVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** What the administrator adds to their DNS settings. */
export function recordFor(
  domain: string,
  token: string,
): { type: "TXT"; name: string; value: string } {
  return {
    type: "TXT",
    name: recordName(domain),
    value: `${DOMAIN_RECORD_PREFIX}${token}`,
  };
}

export function recordName(domain: string): string {
  return `${DOMAIN_RECORD_LABEL}.${domain}`;
}

export type RecordCheck =
  /** A record carries the token. */
  | "match"
  /** No `openokr-verify=` record at the name. */
  | "missing"
  /** An `openokr-verify=` record exists and carries another token. */
  | "mismatch"
  /** The resolver did not answer, which says nothing about the domain. */
  | "unavailable";

/**
 * Looks the record up and compares in constant time.
 *
 * The comparison is between digests, so what is compared is the same length
 * whatever the record holds, and a mismatch cannot be walked toward a match
 * one byte at a time.
 */
export async function checkDomainRecord(
  dns: DomainResolver,
  domain: string,
  tokenHash: string,
): Promise<RecordCheck> {
  let records: string[][];
  try {
    records = await dns.resolveTxt(recordName(domain));
  } catch {
    return "unavailable";
  }
  const expected = Buffer.from(tokenHash, "hex");
  let sawRecord = false;
  let matched = false;
  for (const chunks of records) {
    // DNS splits a long record into chunks of at most 255 bytes.
    const value = chunks.join("").trim();
    if (!value.startsWith(DOMAIN_RECORD_PREFIX)) {
      continue;
    }
    sawRecord = true;
    const given = Buffer.from(
      hashVerificationToken(value.slice(DOMAIN_RECORD_PREFIX.length)),
      "hex",
    );
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      matched = true;
    }
  }
  if (matched) {
    return "match";
  }
  return sawRecord ? "mismatch" : "missing";
}

/** Rule 1, as the sentence an administrator reads. */
export function freeMailRefusal(domain: string): SSOConnectionRejected {
  return new SSOConnectionRejected({
    field: "domain",
    message:
      `${domain} is a free email provider. Nobody can prove they own it, ` +
      "so it cannot be verified.",
  });
}

/** Rule 2, naming neither workspace. */
export function domainTakenRefusal(): SSOConnectionRejected {
  return new SSOConnectionRejected({
    field: "domain",
    message:
      "Another workspace on this instance has already verified this domain, " +
      "so it cannot be verified here.",
  });
}

/**
 * Whether `error` is the unique violation on the verified-owner index, which
 * is rule 2 held by the database. Drizzle wraps the driver's error, so both
 * levels are read.
 */
export function isDomainTaken(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth += 1) {
    const { code, constraint, cause } = e as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (code === "23505" && constraint === "sso_domains_verified_owner_idx") {
      return true;
    }
    e = cause;
  }
  return false;
}

/**
 * Every verified domain on the instance, as `workspaceId|domain` keys.
 *
 * Through `app.sso_lookup` for the reason the provider list is: a sign-up has
 * no workspace. Migration 0165's policy admits `select` on verified, live
 * rows of this table and nothing else.
 */
export async function listVerifiedDomainKeys(
  pool: Pool,
): Promise<ReadonlySet<string>> {
  try {
    const { rows } = await withSSOLookup(drizzle(pool), (tx) =>
      tx.execute<{ workspace_id: string; domain: string }>(sql`
        select workspace_id, domain
          from sso_domains
         where verified_at is not null
           and deleted_at is null`),
    );
    return new Set(
      rows.map((row) => verifiedKey(row.workspace_id, row.domain)),
    );
  } catch (error) {
    // A database without migration 0165 has proved nothing, which is the
    // same answer: no sign-up is refused on a domain nobody verified.
    if (error instanceof Error && error.message.includes("sso_domains")) {
      return new Set();
    }
    throw error;
  }
}

export const verifiedKey = (workspaceId: string, domain: string): string =>
  `${workspaceId}|${domain}`;
