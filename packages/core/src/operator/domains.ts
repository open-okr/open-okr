/**
 * An instance administrator marking a domain verified by hand (docs/design/
 * sso-domain-verification.md, rule 6).
 *
 * **For an instance with no public DNS.** An air-gapped installation cannot
 * publish or look up the TXT record, and the people who run it are the ones
 * who know the domain is theirs. This is how they say so.
 *
 * **This is the operator's way in.** The operator is the grant
 * `pnpm cloud:operator` makes and `isLiveOperator` reads, and on a managed
 * cloud it is the only way: a customer's administrator is not the instance's.
 * The administrator of a self-hosted instance uses the registry action
 * `sso.markDomainVerified`, which refuses on a cloud. Both write through
 * `markVerifiedByHand`, so they record the same thing and name their authority.
 *
 * A reason is required, and the audit row names the administrator and the
 * reason. A free-mail domain is refused here too: rule 1 is about whose
 * domain it can be, not about how it is proved.
 */
import { activeOnly, ssoDomains } from "@openokr/db";
import { isFreeMailDomain } from "@openokr/formats";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { z } from "zod";
import { SSOConnectionRejected } from "../auth/sso.ts";
import {
  domainTakenRefusal,
  freeMailRefusal,
  hashVerificationToken,
  isDomainTaken,
  newVerificationToken,
  normaliseDomain,
} from "../auth/sso-domains.ts";
import {
  OperationError,
  type OperationOutcome,
  type OperationTx,
  runOperation,
} from "../operations/operation.ts";
import { isLiveOperator } from "./store.ts";

const reasonSchema = z
  .string()
  .trim()
  .min(1, "Marking a domain verified by hand needs a reason.")
  .max(500);

export interface MarkDomainVerifiedInput {
  readonly operatorUserId: string;
  readonly workspaceId: string;
  readonly domain: string;
  readonly reason: string;
}

export async function markDomainVerifiedAsOperator(
  pool: Pool,
  input: MarkDomainVerifiedInput,
): Promise<{ readonly domain: string; readonly verified: true }> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    // Not-found rather than forbidden, as `setWorkspaceLifecycle` does: a
    // caller who is no administrator learns nothing about the workspace.
    throw new OperationError("not_found", "No such workspace.");
  }
  const reason = reasonSchema.parse(input.reason);
  const domain = normaliseDomain(input.domain);
  if (domain === null) {
    throw new SSOConnectionRejected({
      field: "domain",
      message: `"${input.domain.trim()}" is not a domain. Write it like acme.com.`,
    });
  }
  if (isFreeMailDomain(domain)) {
    throw freeMailRefusal(domain);
  }

  return runOperation(
    { pool },
    {
      action: "sso.markDomainVerified",
      workspaceId: input.workspaceId,
      actor: { kind: "operator", userId: input.operatorUserId },
      execute: ({ tx, workspaceId }) =>
        markVerifiedByHand(tx, {
          workspaceId,
          domain,
          userId: input.operatorUserId,
          reason,
          authority: "operator",
        }),
    },
  );
}

/** Who vouched for a domain that DNS did not. Recorded on the audit row. */
export type ManualAuthority = "operator" | "instance_admin";

/**
 * Marks a domain verified without a DNS record, inside the operation that
 * calls it (rule 6). Both ways in share it, so the two cannot differ in what
 * they write: the live operator (`operator/domains.ts`) and the administrator
 * of a self-hosted instance (`sso.markDomainVerified`).
 *
 * `verified_by` is the person's user id, which is what keeps the daily
 * re-check away from it. The authority and the reason are on the audit row.
 */
export async function markVerifiedByHand(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly domain: string;
    readonly userId: string;
    readonly reason: string;
    readonly authority: ManualAuthority;
  },
): Promise<OperationOutcome<{ domain: string; verified: true }>> {
  const { workspaceId, domain } = input;
  const now = new Date();
  const [existing] = await tx
    .select()
    .from(ssoDomains)
    .where(
      activeOnly(
        ssoDomains,
        and(
          eq(ssoDomains.workspaceId, workspaceId),
          eq(ssoDomains.domain, domain),
        ),
      ),
    )
    .limit(1);
  let id = existing?.id;
  try {
    if (existing) {
      // openokr:allow-mutation: this is the calling operation's own execute.
      await tx
        .update(ssoDomains)
        .set({
          verifiedAt: now,
          verifiedBy: input.userId,
          failedChecks: 0,
          lastCheckedAt: now,
          updatedAt: now,
        })
        .where(activeOnly(ssoDomains, eq(ssoDomains.id, existing.id)));
    } else {
      // No token was ever issued, and one is stored anyway because the
      // column is not null. Nobody holds it, so nothing can verify against it.
      // openokr:allow-mutation: this is the calling operation's own execute.
      const [inserted] = await tx
        .insert(ssoDomains)
        .values({
          workspaceId,
          domain,
          tokenHash: hashVerificationToken(newVerificationToken()),
          verifiedAt: now,
          verifiedBy: input.userId,
          lastCheckedAt: now,
        })
        .returning({ id: ssoDomains.id });
      id = inserted?.id;
    }
  } catch (error) {
    if (isDomainTaken(error)) {
      throw domainTakenRefusal();
    }
    throw error;
  }
  return {
    result: { domain, verified: true as const },
    activity: {
      kind: "sso.domain_verified",
      subjectType: "workspace",
      subjectId: workspaceId,
      payload: { domain, by: "administrator" },
    },
    audit: {
      action: "sso.markDomainVerified",
      targetType: "sso_domain",
      targetId: id,
      payload: {
        domain,
        reason: input.reason,
        authority: input.authority,
        userId: input.userId,
      },
    },
  };
}
