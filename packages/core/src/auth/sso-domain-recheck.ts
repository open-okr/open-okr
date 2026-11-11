/**
 * The daily re-check of verified domains (docs/design/
 * sso-domain-verification.md, "The record").
 *
 * A domain somebody verified last year may have changed hands or lost its
 * record. Every verified domain is looked up again each day. A check that
 * finds the record resets the count. One that does not adds to it, and the
 * third failure in a row moves the domain back to unverified, so the refusal
 * of password sign-ups on it stops until it verifies again. Three, because
 * that is about three days and a DNS change in progress should not flap.
 *
 * **Only domains the record proved are looked up** (`verified_by = 'dns'`).
 * An instance administrator marks a domain by hand because the instance has no
 * public DNS, and looking those up would fail every day and revoke the very
 * thing the override exists to grant.
 *
 * **A resolver that does not answer is not a failed check.** It says nothing
 * about the domain. Counting it would unverify every domain on an instance
 * whose DNS was down for three days.
 *
 * Each change of state is an Operation, so it commits with its activity and
 * audit row (rule 7). A clean pass changes nothing worth auditing, so it
 * writes only the time it was checked.
 */
import { activeOnly, ssoDomains, withWorkspace } from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { runOperation } from "../operations/operation.ts";
import {
  checkDomainRecord,
  DOMAIN_FAILURE_LIMIT,
  type DomainResolver,
} from "./sso-domains.ts";

export interface DomainRecheckResult {
  /** Domains looked up. */
  readonly checked: number;
  /** Lookups that found no matching record. */
  readonly failed: number;
  /** Domains that lost verification on this pass. */
  readonly unverified: number;
  /** Lookups the resolver did not answer. */
  readonly unavailable: number;
}

export async function recheckSSODomains(
  pool: Pool,
  workspaceId: string,
  dns: DomainResolver,
  now: Date = new Date(),
): Promise<DomainRecheckResult> {
  const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select()
      .from(ssoDomains)
      .where(
        activeOnly(
          ssoDomains,
          and(
            eq(ssoDomains.workspaceId, workspaceId),
            eq(ssoDomains.verifiedBy, "dns"),
            sql`${ssoDomains.verifiedAt} is not null`,
          ),
        ),
      ),
  );

  let failed = 0;
  let unverified = 0;
  let unavailable = 0;
  for (const row of rows) {
    const check = await checkDomainRecord(dns, row.domain, row.tokenHash);
    if (check === "unavailable") {
      unavailable += 1;
      continue;
    }
    if (check === "match") {
      if (row.failedChecks === 0) {
        await withWorkspace(drizzle(pool), workspaceId, async (tx) => {
          // openokr:allow-mutation: bookkeeping of when a clean check ran. It
          // changes no state anybody could audit, and an audit row per domain
          // per day would bury the ones that matter.
          await tx
            .update(ssoDomains)
            .set({ lastCheckedAt: now })
            .where(activeOnly(ssoDomains, eq(ssoDomains.id, row.id)));
        });
        continue;
      }
      await runOperation(
        { pool },
        {
          action: "sso.recheckDomain",
          workspaceId,
          actor: { kind: "system" },
          async execute({ tx }) {
            // openokr:allow-mutation: this is the operation's own execute.
            await tx
              .update(ssoDomains)
              .set({ failedChecks: 0, lastCheckedAt: now, updatedAt: now })
              .where(activeOnly(ssoDomains, eq(ssoDomains.id, row.id)));
            return {
              result: undefined,
              activity: {
                kind: "sso.domain_check_recovered",
                subjectType: "workspace",
                subjectId: workspaceId,
                payload: { domain: row.domain },
              },
              audit: {
                action: "sso.domainCheckRecovered",
                targetType: "sso_domain",
                targetId: row.id,
                payload: {
                  domain: row.domain,
                  failedChecksBefore: row.failedChecks,
                },
              },
            };
          },
        },
      );
      continue;
    }

    failed += 1;
    const failures = row.failedChecks + 1;
    const losesIt = failures >= DOMAIN_FAILURE_LIMIT;
    if (losesIt) {
      unverified += 1;
    }
    await runOperation(
      { pool },
      {
        action: losesIt ? "sso.domainUnverified" : "sso.recheckDomain",
        workspaceId,
        actor: { kind: "system" },
        async execute({ tx }) {
          // openokr:allow-mutation: this is the operation's own execute.
          await tx
            .update(ssoDomains)
            .set(
              losesIt
                ? {
                    verifiedAt: null,
                    verifiedBy: null,
                    failedChecks: 0,
                    lastCheckedAt: now,
                    updatedAt: now,
                  }
                : {
                    failedChecks: failures,
                    lastCheckedAt: now,
                    updatedAt: now,
                  },
            )
            .where(activeOnly(ssoDomains, eq(ssoDomains.id, row.id)));
          return {
            result: undefined,
            activity: {
              kind: losesIt
                ? "sso.domain_unverified"
                : "sso.domain_check_failed",
              subjectType: "workspace",
              subjectId: workspaceId,
              payload: { domain: row.domain },
            },
            audit: {
              action: losesIt
                ? "sso.domainUnverified"
                : "sso.domainCheckFailed",
              targetType: "sso_domain",
              targetId: row.id,
              payload: {
                domain: row.domain,
                reason: check,
                failedChecks: failures,
              },
            },
          };
        },
      },
    );
  }

  return {
    checked: rows.length - unavailable,
    failed,
    unverified,
    unavailable,
  };
}
