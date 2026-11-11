/**
 * A workspace's email domains and the proof that it owns them (docs/design/
 * sso-domain-verification.md).
 *
 * **Three actions, all `full`.** Which domains a workspace claims for single
 * sign-on is administration, as the connections themselves are.
 *
 * | Action | Does |
 * |---|---|
 * | `sso.listDomains` | Every domain on a connection or already started, with its state |
 * | `sso.startDomainVerification` | Makes the token, stores its SHA-256, returns the token once |
 * | `sso.verifyDomain` | Looks the record up through the DNS port and verifies on a match |
 *
 * | `sso.markDomainVerified` | Marks a domain by hand, for an instance with no public DNS. Self-hosted only |
 *
 * **Marking by hand has two ways in.** The administrator of a self-hosted
 * instance uses the action above, which refuses when the cloud flag is on. On
 * a managed cloud only the operator may, through `markDomainVerifiedAsOperator`
 * in `operator/domains.ts`. Both record a reason and name their authority.
 */
import {
  activeOnly,
  ssoConnections,
  ssoDomains,
  withWorkspace,
} from "@openokr/db";
import { isFreeMailDomain } from "@openokr/formats";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { SSOConnectionRejected, splitDomains } from "../auth/sso.ts";
import {
  checkDomainRecord,
  domainTakenRefusal,
  freeMailRefusal,
  hashVerificationToken,
  isDomainTaken,
  newVerificationToken,
  normaliseDomain,
  recordFor,
  recordName,
} from "../auth/sso-domains.ts";
import { OperationError } from "../operations/operation.ts";
import { markVerifiedByHand } from "../operator/domains.ts";
import { isCloudEnabled } from "../tenancy/settings.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const domainInput = z.object({ domain: z.string().min(1).max(253) });

/**
 * `failing` is verified with a failed re-check behind it: still verified, and
 * on its way to not being. `not_started` is a domain a connection lists that
 * nobody has asked to verify.
 */
const statusSchema = z.enum([
  "not_started",
  "unverified",
  "verified",
  "failing",
]);

const domainOutput = z.object({
  domain: z.string(),
  status: statusSchema,
  /** `dns`, or `administrator` for a manual mark. Null until verified. */
  verifiedBy: z.enum(["dns", "administrator"]).nullable(),
  verifiedAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  failedChecks: z.number().int(),
  /** Where the record goes. The token is never read back. */
  recordName: z.string(),
  /** Whether this domain can never be verified, because it is free mail. */
  freeMail: z.boolean(),
  /** Whether a connection of this workspace lists it. */
  onConnection: z.boolean(),
});

export type SSODomainDetails = z.infer<typeof domainOutput>;

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

function toDetails(
  domain: string,
  row:
    | {
        verifiedAt: Date | null;
        verifiedBy: string | null;
        lastCheckedAt: Date | null;
        failedChecks: number;
      }
    | undefined,
  onConnection: boolean,
): SSODomainDetails {
  const verified = row?.verifiedAt != null;
  return {
    domain,
    status: !row
      ? "not_started"
      : !verified
        ? "unverified"
        : row.failedChecks > 0
          ? "failing"
          : "verified",
    verifiedBy: !verified
      ? null
      : row?.verifiedBy === "dns"
        ? "dns"
        : "administrator",
    verifiedAt: iso(row?.verifiedAt ?? null),
    lastCheckedAt: iso(row?.lastCheckedAt ?? null),
    failedChecks: row?.failedChecks ?? 0,
    recordName: recordName(domain),
    freeMail: isFreeMailDomain(domain),
    onConnection,
  };
}

/** The domain as stored, or the refusal an administrator reads. */
function acceptable(input: string): string {
  const domain = normaliseDomain(input);
  if (domain === null) {
    throw new SSOConnectionRejected({
      field: "domain",
      message: `"${input.trim()}" is not a domain. Write it like acme.com, without @ or https://.`,
    });
  }
  if (isFreeMailDomain(domain)) {
    throw freeMailRefusal(domain);
  }
  return domain;
}

export const listSSODomains = defineReadAction({
  name: "sso.listDomains",
  summary:
    "The email domains this workspace's single sign-on connections list or have started to verify, each with its verification state and the DNS record name.",
  input: z.object({}),
  output: z.array(domainOutput),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    return withWorkspace(
      drizzle(context.pool),
      context.workspaceId,
      async (tx) => {
        const [rows, connections] = await Promise.all([
          tx
            .select()
            .from(ssoDomains)
            .where(
              activeOnly(
                ssoDomains,
                eq(ssoDomains.workspaceId, context.workspaceId),
              ),
            )
            .orderBy(asc(ssoDomains.domain)),
          tx
            .select({ emailDomains: ssoConnections.emailDomains })
            .from(ssoConnections)
            .where(
              activeOnly(
                ssoConnections,
                eq(ssoConnections.workspaceId, context.workspaceId),
              ),
            ),
        ]);
        const listed = new Set(
          connections.flatMap((c) => splitDomains(c.emailDomains)),
        );
        const byDomain = new Map(rows.map((row) => [row.domain, row]));
        const all = [...new Set([...listed, ...byDomain.keys()])].sort();
        return all.map((domain) =>
          toDetails(domain, byDomain.get(domain), listed.has(domain)),
        );
      },
    );
  },
});

export const startSSODomainVerification = defineWriteAction({
  name: "sso.startDomainVerification",
  summary:
    "Starts proving that this workspace owns an email domain. Returns the DNS TXT record to publish, including a token that is shown this once. Calling it again for an unverified domain issues a new token.",
  input: domainInput,
  output: z.object({
    domain: z.string(),
    record: z.object({
      type: z.literal("TXT"),
      name: z.string(),
      value: z.string(),
    }),
    /** The token inside the record's value, shown once and never stored. */
    token: z.string(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const domain = acceptable(input.domain);
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
      if (existing?.verifiedAt) {
        throw new SSOConnectionRejected({
          field: "domain",
          message: `${domain} is already verified.`,
        });
      }

      const token = newVerificationToken();
      const tokenHash = hashVerificationToken(token);
      let id: string;
      // openokr:allow-mutation: this is the operation's own execute.
      if (existing) {
        id = existing.id;
        await tx
          .update(ssoDomains)
          .set({ tokenHash, failedChecks: 0, updatedAt: new Date() })
          .where(activeOnly(ssoDomains, eq(ssoDomains.id, existing.id)));
      } else {
        const [inserted] = await tx
          .insert(ssoDomains)
          .values({ workspaceId, domain, tokenHash })
          .returning({ id: ssoDomains.id });
        id = inserted?.id ?? "";
      }

      return {
        result: { domain, record: recordFor(domain, token), token },
        activity: {
          kind: "sso.domain_verification_started",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { domain },
        },
        audit: {
          action: "sso.startDomainVerification",
          targetType: "sso_domain",
          targetId: id,
          // Never the token or its hash: the audit trail is read by more
          // people than the record is meant for.
          payload: { domain, reissued: existing !== undefined },
        },
      };
    },
  }),
});

const verifyOutput = z.object({
  domain: z.string(),
  verified: z.boolean(),
  /** Why not, when not. `lookup_failed` means the resolver did not answer. */
  reason: z
    .enum(["record_missing", "record_mismatch", "lookup_failed"])
    .nullable(),
});

export const verifySSODomain = defineWriteAction({
  name: "sso.verifyDomain",
  summary:
    "Looks up the DNS TXT record for a domain this workspace started verifying and marks the domain verified when it carries the token. On a verified domain whose daily check is failing, a match clears the failure and a miss changes nothing. A domain on the free-mail list cannot be verified, and neither can one another workspace on this instance already verified.",
  input: domainInput,
  output: verifyOutput,
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const domain = acceptable(input.domain);
      const [row] = await tx
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
      if (!row) {
        throw new SSOConnectionRejected({
          field: "domain",
          message: `Start verifying ${domain} first, so there is a record to look for.`,
        });
      }
      const audit = (outcome: string, extra: Record<string, unknown> = {}) => ({
        action: "sso.verifyDomain",
        targetType: "sso_domain",
        targetId: row.id,
        payload: { domain, outcome, ...extra },
      });
      const activity = (kind: string) => ({
        kind,
        subjectType: "workspace",
        subjectId: workspaceId,
        payload: { domain },
      });

      // A verified domain whose daily check is failing may be looked up again
      // by hand. A verified one with nothing failing needs nothing.
      const recovering = row.verifiedAt !== null && row.failedChecks > 0;
      if (row.verifiedAt && !recovering) {
        return {
          result: { domain, verified: true, reason: null },
          activity: activity("sso.domain_checked"),
          audit: audit("already_verified"),
        };
      }
      if (!context.dns) {
        throw new OperationError(
          "not_found",
          "This instance has no DNS resolver to check the record with. An instance administrator can mark the domain verified by hand.",
        );
      }

      const now = new Date();
      const check = await checkDomainRecord(context.dns, domain, row.tokenHash);
      if (check !== "match") {
        // A miss on a domain that is verified already leaves the row alone:
        // only the daily job counts toward unverifying it, so pressing the
        // button cannot speed that up.
        if (!recovering) {
          // openokr:allow-mutation: this is the operation's own execute.
          await tx
            .update(ssoDomains)
            .set({ lastCheckedAt: now, updatedAt: now })
            .where(activeOnly(ssoDomains, eq(ssoDomains.id, row.id)));
        }
        return {
          result: {
            domain,
            verified: false,
            reason:
              check === "missing"
                ? ("record_missing" as const)
                : check === "mismatch"
                  ? ("record_mismatch" as const)
                  : ("lookup_failed" as const),
          },
          activity: activity("sso.domain_checked"),
          audit: audit(check),
        };
      }

      if (recovering) {
        // openokr:allow-mutation: this is the operation's own execute.
        await tx
          .update(ssoDomains)
          .set({ failedChecks: 0, lastCheckedAt: now, updatedAt: now })
          .where(activeOnly(ssoDomains, eq(ssoDomains.id, row.id)));
        return {
          result: { domain, verified: true, reason: null },
          activity: activity("sso.domain_check_recovered"),
          audit: {
            ...audit("recovered", { failedChecksBefore: row.failedChecks }),
            action: "sso.domainCheckRecovered",
          },
        };
      }

      try {
        // openokr:allow-mutation: this is the operation's own execute.
        await tx
          .update(ssoDomains)
          .set({
            verifiedAt: now,
            verifiedBy: "dns",
            failedChecks: 0,
            lastCheckedAt: now,
            updatedAt: now,
          })
          .where(activeOnly(ssoDomains, eq(ssoDomains.id, row.id)));
      } catch (error) {
        // Rule 2, held by the database: another workspace got there first.
        if (isDomainTaken(error)) {
          throw domainTakenRefusal();
        }
        throw error;
      }
      return {
        result: { domain, verified: true, reason: null },
        activity: activity("sso.domain_verified"),
        audit: audit("verified", { by: "dns" }),
      };
    },
  }),
});

export const markSSODomainVerified = defineWriteAction({
  name: "sso.markDomainVerified",
  summary:
    "Marks a domain verified without a DNS record, for a self-hosted instance with no public DNS. Refused on a managed cloud, where only the operator may. A reason is required and the audit row records it.",
  input: z.object({
    domain: z.string().min(1).max(253),
    reason: z
      .string()
      .trim()
      .min(1, "Marking a domain verified by hand needs a reason.")
      .max(500),
  }),
  output: z.object({ domain: z.string(), verified: z.literal(true) }),
  access: ACCESS_LEVELS.full,
  // A person's decision about their own network. Not something an agent
  // proposes: the proof it replaces exists so that nobody can say it for free.
  agentSurface: false,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      // **The instance administrator is whoever administers a workspace when
      // the instance is self-hosted**, the rule the instance-name card and the
      // AI endpoint guard already use: on a managed cloud the administrator of
      // one customer is not the administrator of the instance, and the
      // operator is (`markDomainVerifiedAsOperator`).
      if (await isCloudEnabled(context.pool)) {
        throw new OperationError(
          "forbidden",
          "On a managed cloud only the operator can mark a domain verified without a record.",
        );
      }
      const userId = context.actor.userId;
      if (context.actor.kind !== "human" || !userId) {
        throw new OperationError(
          "forbidden",
          "Only a person can mark a domain verified without a record.",
        );
      }
      const domain = acceptable(input.domain);
      return markVerifiedByHand(tx, {
        workspaceId,
        domain,
        userId,
        reason: input.reason,
        authority: "instance_admin",
      });
    },
  }),
});
