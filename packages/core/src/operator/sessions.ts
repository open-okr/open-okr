/**
 * Support access: the session an operator asks for and a customer grants
 * (P8-T04a).
 *
 * Design: `docs/design/p8-t01b-support-access.md`.
 *
 * **Consent is the only way in.** An operator asks; a member of the workspace
 * who can manage access says yes or no. There is no path here that an
 * operator can take alone, and that is the product promise rather than an
 * implementation detail.
 *
 * **The session is a binding, not a bypass.** Granting one creates a real
 * `guest` member row through `provisionMemberForInvite`, the one funnel every
 * joining path uses, bound on the workspace context at the level the customer
 * chose. From that moment `can()` answers for the operator exactly as it
 * answers for anybody else: the access getter returns not-found on a space
 * they were not bound to, the Operation pipeline writes its activity, audit
 * and outbox rows, and the freeze overlay refuses writes into a suspended
 * workspace. There is no second authorisation path that could disagree with
 * the first.
 *
 * **A guest is not a seat** (`p8-t01b-plans-and-seats.md`), so support costs
 * the customer nothing.
 */
import {
  activeOnly,
  type OperatorSessionEndReason,
  operatorSessions,
  withInstanceAdmin,
  withOperator,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { eq, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { provisionMemberForInvite } from "../invitations/provisioning.ts";
import { OperationError, runOperation } from "../operations/operation.ts";
import { isLiveOperator } from "./store.ts";

/** How long a session may run. */
const DEFAULT_HOURS = 4;
const MAXIMUM_HOURS = 24;

/**
 * The levels a customer may grant.
 *
 * **`full` is deliberately absent.** It includes changing who else has
 * access, so an operator holding it could extend their own session, and a
 * session that can extend itself has no time box.
 */
const GRANTABLE_LEVELS = [
  ACCESS_LEVELS.view,
  ACCESS_LEVELS.comment,
  ACCESS_LEVELS.edit,
] as const;

const requestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Say why you need to enter this workspace.")
    .max(500),
});

const grantSchema = z.object({
  hours: z.number().int().min(1).max(MAXIMUM_HOURS).default(DEFAULT_HOURS),
  level: z
    .number()
    .refine(
      (value) => (GRANTABLE_LEVELS as readonly number[]).includes(value),
      "A support session may be granted at view, comment or edit. Never full.",
    )
    .default(ACCESS_LEVELS.view),
});

export interface RequestSupportInput {
  readonly workspaceId: string;
  readonly operatorUserId: string;
  readonly reason: string;
}

/**
 * An operator asks. Nothing is granted and nothing is readable yet.
 *
 * Written under the operator's own key rather than through an Operation:
 * there is no acting member in the workspace to authorise, which is the whole
 * situation this exists to resolve. The grant, which is the part that
 * actually changes access, is an Operation on the customer's side.
 */
export async function requestSupportSession(
  pool: Pool,
  input: RequestSupportInput,
): Promise<{ readonly id: string }> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    // Not-found rather than forbidden, like the console's other doors: a
    // caller who is not an operator learns nothing, including whether the
    // workspace exists.
    throw new OperationError("not_found", "No such workspace.");
  }
  const { reason } = requestSchema.parse({ reason: input.reason });

  const db = drizzle(pool);
  const [row] = await withOperator(db, input.operatorUserId, (tx) =>
    // openokr:allow-mutation: a request is not a change to the workspace. It
    // grants nothing, reads nothing and has no acting member to authorise;
    // the grant is where an Operation belongs, and that is below.
    tx
      .insert(operatorSessions)
      .values({
        workspaceId: input.workspaceId,
        operatorUserId: input.operatorUserId,
        reason,
      })
      .returning({ id: operatorSessions.id }),
  );

  if (!row) {
    throw new OperationError(
      "forbidden",
      "There is already a live or pending request for this workspace.",
    );
  }
  return row;
}

export interface GrantSupportInput {
  readonly workspaceId: string;
  readonly sessionId: string;
  /** The member saying yes. */
  readonly grantedByUserId: string;
  readonly hours?: number;
  readonly level?: number;
}

/**
 * The customer says yes.
 *
 * An Operation, because it changes who can read the workspace, and that is
 * exactly the kind of change the pipeline exists to record. The audit row
 * names the member who granted it and the operator it was granted to.
 */
export async function grantSupportSession(
  pool: Pool,
  input: GrantSupportInput,
): Promise<{ readonly expiresAt: Date }> {
  const { hours, level } = grantSchema.parse({
    ...(input.hours === undefined ? {} : { hours: input.hours }),
    ...(input.level === undefined ? {} : { level: input.level }),
  });

  return runOperation(
    { pool },
    {
      action: "support.grant",
      workspaceId: input.workspaceId,
      actor: { kind: "human", userId: input.grantedByUserId },
      // Granting access is managing access, so it takes the level that
      // manages it. A member who cannot change who is in the workspace
      // cannot let somebody outside it in either.
      async load({ tx, workspaceId }) {
        const [session] = await tx
          .select()
          .from(operatorSessions)
          .where(
            activeOnly(
              operatorSessions,
              eq(operatorSessions.id, input.sessionId),
              eq(operatorSessions.workspaceId, workspaceId),
              isNull(operatorSessions.endedAt),
              isNull(operatorSessions.grantedAt),
            ),
          )
          .limit(1);
        if (!session) {
          throw new OperationError(
            "not_found",
            "No such request, or it has already been answered.",
          );
        }
        return session;
      },
      async execute({ tx, workspaceId, loaded, actor }) {
        if (!actor.memberId) {
          throw new OperationError(
            "forbidden",
            "Only a member of this workspace can grant support access.",
          );
        }

        // The one funnel. A guest member, bound at the level the customer
        // chose, so `can()` is what answers from here on.
        const member = await provisionMemberForInvite(tx, {
          workspaceId,
          user: {
            id: loaded.operatorUserId,
            name: "OpenOKR support",
          },
          kind: "guest",
          level: level as (typeof GRANTABLE_LEVELS)[number],
        });

        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        // openokr:allow-mutation: this is the Operation's own transaction.
        await tx
          .update(operatorSessions)
          .set({
            grantedAt: new Date(),
            grantedByMemberId: actor.memberId,
            expiresAt,
            memberId: member.memberId,
            level,
            updatedAt: new Date(),
          })
          .where(
            activeOnly(
              operatorSessions,
              eq(operatorSessions.id, input.sessionId),
            ),
          );

        return {
          result: { expiresAt },
          activity: {
            kind: "support.granted",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { hours, level },
          },
          audit: {
            action: "support.grant",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              operatorUserId: loaded.operatorUserId,
              reason: loaded.reason,
              hours,
              level,
            },
          },
        };
      },
    },
  );
}

export interface EndSupportInput {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly reason: OperatorSessionEndReason;
  /** Absent for the sweep, which has no acting member. */
  readonly endedByUserId?: string;
}

/**
 * Ends one, whatever ended it.
 *
 * The member row is suspended rather than deleted, because everything the
 * operator did while inside is attributed to them and an author who no longer
 * exists is a falsified record.
 */
export async function endSupportSession(
  pool: Pool,
  input: EndSupportInput,
): Promise<void> {
  await runOperation(
    { pool },
    {
      action: "support.end",
      workspaceId: input.workspaceId,
      actor: input.endedByUserId
        ? { kind: "human", userId: input.endedByUserId }
        : { kind: "system" },
      async load({ tx, workspaceId }) {
        const [session] = await tx
          .select()
          .from(operatorSessions)
          .where(
            activeOnly(
              operatorSessions,
              eq(operatorSessions.id, input.sessionId),
              eq(operatorSessions.workspaceId, workspaceId),
              isNull(operatorSessions.endedAt),
            ),
          )
          .limit(1);
        if (!session) {
          throw new OperationError("not_found", "No such live session.");
        }
        return session;
      },
      async execute({ tx, workspaceId, loaded }) {
        const now = new Date();
        // openokr:allow-mutation: the Operation's own transaction.
        await tx
          .update(operatorSessions)
          .set({ endedAt: now, endedReason: input.reason, updatedAt: now })
          .where(
            activeOnly(
              operatorSessions,
              eq(operatorSessions.id, input.sessionId),
            ),
          );

        if (loaded.memberId) {
          // Suspended, never deleted. `resolveActor` refuses a suspended
          // member everything, and the operator's own rows keep their author.
          // openokr:allow-mutation: the Operation's own transaction.
          await tx
            .update(workspaceMembers)
            .set({ status: "suspended", suspendedAt: now, updatedAt: now })
            .where(
              activeOnly(
                workspaceMembers,
                eq(workspaceMembers.id, loaded.memberId),
              ),
            );
        }

        return {
          result: undefined,
          activity: {
            kind: "support.ended",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { reason: input.reason },
          },
          audit: {
            action: "support.end",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              operatorUserId: loaded.operatorUserId,
              reason: input.reason,
            },
          },
        };
      },
    },
  );
}

interface ExpiredSession {
  readonly id: string;
  readonly workspaceId: string;
}

/**
 * Every granted session past its expiry.
 *
 * **The sweep is the tidying, not the enforcement.** Between two sweeps a
 * session would otherwise be expired on paper and live in fact, so
 * `resolveActor` refuses an expired one at use, on every action. This is what
 * stamps the row, suspends the member and lets the owner's screen stop saying
 * somebody is inside.
 */
async function findExpiredSessions(
  pool: Pool,
  now: Date = new Date(),
): Promise<readonly ExpiredSession[]> {
  const db = drizzle(pool);
  return withInstanceAdmin(db, (tx) =>
    tx
      .select({
        id: operatorSessions.id,
        workspaceId: operatorSessions.workspaceId,
      })
      .from(operatorSessions)
      .where(
        activeOnly(
          operatorSessions,
          isNull(operatorSessions.endedAt),
          lte(operatorSessions.expiresAt, now),
        ),
      ),
  );
}

/** Ends every session whose time is up. Idempotent. */
export async function sweepExpiredSessions(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ readonly ended: number }> {
  const due = await findExpiredSessions(pool, now);
  for (const session of due) {
    await endSupportSession(pool, {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      reason: "expired",
    });
  }
  return { ended: due.length };
}

/** The live session a workspace's members are entitled to see. */
export async function liveSupportSession(pool: Pool, workspaceId: string) {
  const db = drizzle(pool);
  const [row] = await withWorkspace(db, workspaceId, (tx) =>
    tx
      .select({
        id: operatorSessions.id,
        operatorUserId: operatorSessions.operatorUserId,
        reason: operatorSessions.reason,
        expiresAt: operatorSessions.expiresAt,
        level: operatorSessions.level,
      })
      .from(operatorSessions)
      .where(
        activeOnly(
          operatorSessions,
          eq(operatorSessions.workspaceId, workspaceId),
          isNull(operatorSessions.endedAt),
        ),
      )
      .limit(1),
  );
  // A request that has not been granted is not somebody being inside, so the
  // banner does not claim it is. The grant screen is where a request shows.
  return row?.expiresAt ? row : undefined;
}

/** Every session a workspace has ever had, for its own audit screen. */
export async function listSupportSessions(pool: Pool, workspaceId: string) {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, (tx) =>
    tx
      .select()
      .from(operatorSessions)
      .where(
        activeOnly(
          operatorSessions,
          eq(operatorSessions.workspaceId, workspaceId),
        ),
      ),
  );
}
