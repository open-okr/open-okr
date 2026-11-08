/**
 * What closing a workspace sets going, and when it will be erased
 * (docs/design/workspace-erasure.md §3).
 *
 * **Two side effects, both through the outbox**, so a closure that rolls back sends
 * nothing: the provider is asked to stop renewing the subscription, and every owner
 * and administrator is told the date. Both the owner's door and the operator's
 * enqueue the same two rows, so neither path can forget one.
 */
import {
  activeOnly,
  includeDeleted,
  type OutboxMessage,
  tenants,
  users,
  withInstanceAdmin,
  withWorkspace,
  workspaceMembers,
  workspaceRoles,
} from "@openokr/db";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { runOperation } from "../operations/operation.ts";
import { resolveCloudTenancy } from "./settings.ts";

/** Asks the payment provider to end the subscription at the period's end. */
export const END_SUBSCRIPTION_TOPIC = "billing.endSubscription";
/** Tells the owners and administrators that the workspace closed, and when it goes. */
export const WORKSPACE_CLOSED_TOPIC = "workspace.closed";
/** Tells them again, seven days before it goes. */
export const ERASURE_REMINDER_TOPIC = "workspace.erasureReminder";

/** How long before erasure the reminder goes (workspace-erasure.md §12, decision 3). */
const REMIND_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a workspace closed at `closedAt` is erased, or null while retention is off. */
function erasureDate(closedAt: Date, retentionDays: number): Date | null {
  return retentionDays > 0
    ? new Date(closedAt.getTime() + retentionDays * DAY_MS)
    : null;
}

/** When a workspace closed at `closedAt` will be erased, under this instance's setting. */
export async function erasureDateFor(
  pool: Pool,
  closedAt: Date,
): Promise<Date | null> {
  const cloud = await resolveCloudTenancy(pool);
  return erasureDate(closedAt, cloud.closureRetentionDays);
}

/**
 * The two rows a closure enqueues. Keyed by the closing instant, so closing,
 * reopening and closing again tells people twice, which is right, while a retried
 * write cannot enqueue either twice.
 */
export function closingOutbox(input: {
  readonly workspaceId: string;
  readonly closedAt: Date;
  /** The member who closed it. Null when the provider did. */
  readonly byMemberId: string | null;
}): OutboxMessage[] {
  const instant = input.closedAt.getTime();
  return [
    {
      topic: END_SUBSCRIPTION_TOPIC,
      payload: { workspaceId: input.workspaceId },
      idempotencyKey: `${END_SUBSCRIPTION_TOPIC}:${input.workspaceId}:${instant}`,
    },
    {
      topic: WORKSPACE_CLOSED_TOPIC,
      payload: {
        workspaceId: input.workspaceId,
        closedAt: input.closedAt.toISOString(),
        byMemberId: input.byMemberId,
      },
      idempotencyKey: `${WORKSPACE_CLOSED_TOPIC}:${input.workspaceId}:${instant}`,
    },
  ];
}

export interface ClosureSchedule {
  readonly closedAt: Date;
  /** Null while retention is off: nothing will erase it. */
  readonly eraseOn: Date | null;
  readonly ownerMayReopen: boolean;
}

/**
 * When this closed workspace will be erased, or null when it is not closed.
 *
 * Worked out from the retention setting each time it is read, rather than stored at
 * closing, because the provider may set retention after the workspace closed, and
 * the date people are shown has to be the date erasure will actually use.
 */
export async function readClosureSchedule(
  pool: Pool,
  workspaceId: string,
): Promise<ClosureSchedule | null> {
  const [tenant] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({
        state: tenants.state,
        closedAt: tenants.closedAt,
        ownerMayReopen: tenants.ownerMayReopen,
      })
      .from(tenants)
      .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)))
      .limit(1),
  );
  if (tenant?.state !== "closed" || !tenant.closedAt) {
    return null;
  }
  const cloud = await resolveCloudTenancy(pool);
  return {
    closedAt: tenant.closedAt,
    eraseOn: erasureDate(tenant.closedAt, cloud.closureRetentionDays),
    ownerMayReopen: tenant.ownerMayReopen,
  };
}

interface ClosureRecipient {
  readonly name: string;
  readonly email: string;
}

/**
 * Who hears that a workspace closed: every active owner and administrator with an
 * account, and the name of whoever closed it.
 *
 * Read when the mail is sent rather than when the workspace closed, so somebody
 * made an administrator in between still hears.
 */
export async function readClosureNotice(
  pool: Pool,
  input: { readonly workspaceId: string; readonly byMemberId: string | null },
): Promise<{
  /** Null once it has been reopened: the mail is then out of date. */
  readonly schedule: ClosureSchedule | null;
  readonly closedByName: string | null;
  readonly recipients: readonly ClosureRecipient[];
}> {
  const cloud = await resolveCloudTenancy(pool);
  return withWorkspace(drizzle(pool), input.workspaceId, async (tx) => {
    const [tenant] = await tx
      .select({
        state: tenants.state,
        closedAt: tenants.closedAt,
        ownerMayReopen: tenants.ownerMayReopen,
      })
      .from(tenants)
      .where(activeOnly(tenants, eq(tenants.workspaceId, input.workspaceId)))
      .limit(1);
    const recipients = await tx
      .select({ name: workspaceMembers.name, email: users.email })
      // openokr:allow-raw-read: the system telling a workspace's owners and
      // administrators that it closed. Nobody is reading on anybody's behalf.
      .from(workspaceMembers)
      .innerJoin(workspaceRoles, eq(workspaceRoles.id, workspaceMembers.roleId))
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        activeOnly(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.status, "active"),
            inArray(workspaceRoles.builtinKey, ["owner", "admin"]),
          ),
        ),
      );
    const [closer] = input.byMemberId
      ? await tx
          .select({ name: workspaceMembers.name })
          // openokr:allow-raw-read: the name of whoever closed it, for the mail.
          .from(workspaceMembers)
          // Whoever closed it may have left since. Their name still says who.
          .where(
            includeDeleted(
              workspaceMembers,
              eq(workspaceMembers.id, input.byMemberId),
            ),
          )
          .limit(1)
      : [];
    return {
      schedule:
        tenant?.state === "closed" && tenant.closedAt
          ? {
              closedAt: tenant.closedAt,
              eraseOn: erasureDate(tenant.closedAt, cloud.closureRetentionDays),
              ownerMayReopen: tenant.ownerMayReopen,
            }
          : null,
      closedByName: closer?.name ?? null,
      recipients,
    };
  });
}

/** Thrown inside the Operation when another run reminded first, to write nothing. */
class AlreadyReminded extends Error {}

/**
 * Reminds the owners and administrators of every closed workspace that is erased in
 * seven days or fewer, once per closure (docs/design/workspace-erasure.md §12,
 * decision 3). Run hourly by the scheduler. Returns how many were reminded.
 *
 * **Nothing to do while retention is seven days or fewer**: the notice at closing
 * already gave a date no further away than the reminder would.
 */
export async function remindBeforeErasure(
  pool: Pool,
  options: { readonly now?: Date } = {},
): Promise<number> {
  const cloud = await resolveCloudTenancy(pool);
  if (!cloud.enabled || cloud.closureRetentionDays <= REMIND_DAYS) {
    return 0;
  }
  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - (cloud.closureRetentionDays - REMIND_DAYS) * DAY_MS,
  );
  const due = await withInstanceAdmin(drizzle(pool), (tx) =>
    tx
      .select({ workspaceId: tenants.workspaceId })
      .from(tenants)
      .where(
        activeOnly(
          tenants,
          and(
            eq(tenants.state, "closed"),
            isNull(tenants.erasingAt),
            isNull(tenants.erasureRemindedAt),
            lte(tenants.closedAt, cutoff),
          ),
        ),
      ),
  );
  let reminded = 0;
  for (const { workspaceId: id } of due) {
    try {
      await runOperation(
        { pool },
        {
          action: "workspace.remindErasure",
          workspaceId: id,
          // Nobody is acting: the date arrived.
          actor: { kind: "system" },
          bootstrap: true,
          async execute({ tx, workspaceId }) {
            // openokr:allow-mutation: this Operation's own transaction. Marked
            // here so two schedulers cannot remind twice.
            const [marked] = await tx
              .update(tenants)
              .set({ erasureRemindedAt: now, updatedAt: now })
              .where(
                activeOnly(
                  tenants,
                  and(
                    eq(tenants.workspaceId, workspaceId),
                    eq(tenants.state, "closed"),
                    isNull(tenants.erasingAt),
                    isNull(tenants.erasureRemindedAt),
                  ),
                ),
              )
              .returning({ closedAt: tenants.closedAt });
            if (!marked?.closedAt) {
              throw new AlreadyReminded();
            }
            const eraseOn = erasureDate(
              marked.closedAt,
              cloud.closureRetentionDays,
            ) as Date;
            return {
              result: undefined,
              activity: {
                kind: "workspace.erasure_reminded",
                subjectType: "workspace",
                subjectId: workspaceId,
                payload: { eraseOn: eraseOn.toISOString() },
              },
              audit: {
                action: "workspace.remindErasure",
                targetType: "workspace",
                targetId: workspaceId,
                payload: { eraseOn: eraseOn.toISOString() },
              },
              outbox: [
                {
                  topic: ERASURE_REMINDER_TOPIC,
                  payload: {
                    workspaceId,
                    closedAt: marked.closedAt.toISOString(),
                  },
                  idempotencyKey: `${ERASURE_REMINDER_TOPIC}:${workspaceId}:${marked.closedAt.getTime()}`,
                },
              ],
            };
          },
        },
      );
      reminded += 1;
    } catch (error) {
      if (!(error instanceof AlreadyReminded)) {
        throw error;
      }
    }
  }
  return reminded;
}
