/**
 * Plans and seats (P8-T05).
 *
 * Design: `docs/design/p8-t01b-plans-and-seats.md`.
 *
 * **There is no field here that can name a feature, and there will not be
 * one.** REQUIREMENTS §5 says self-host is never feature-gated and PLAN.md §4
 * says the managed cloud sells operation rather than features. A plan that
 * can turn a feature off is how that stops being true, and the way it arrives
 * is an empty list somebody adds "for later". A plan is a seat count and a
 * spend cap, and that is the whole of it.
 *
 * **The catalogue is an instance setting, not a table.** It is operator
 * configuration for one deployment, it changes rarely, and it has no
 * per-tenant rows. Adding a plan is an edit rather than a migration.
 */
import {
  activeOnly,
  operatorWorkspaceUsage,
  tenants,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { OperationError } from "../operations/errors.ts";
import { readSetting } from "../secrets/instance-settings.ts";
import { readTenant } from "./store.ts";

const CLOUD_PLANS_KEY = "cloud.plans";

/**
 * One plan.
 *
 * `seats` null means unlimited, which is also what the free tier is today.
 * That is almost certainly not what a real free tier does, and the design
 * names it as an open question rather than guessing at it here.
 */
const planSchema = z.object({
  key: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  /** Null is unlimited. */
  seats: z.number().int().min(1).nullable().default(null),
  /** Written into the existing `ai_budgets` workspace row. No new mechanism. */
  aiMonthlyUsd: z.number().min(0).nullable().default(null),
});

export type Plan = z.infer<typeof planSchema>;

const plansSchema = z.array(planSchema);

/**
 * The member statuses that hold a seat.
 *
 * **`invited` counts, and that is the load-bearing choice.** If only `active`
 * did, a workspace at its limit could invite a hundred people, every
 * invitation would succeed, and every one of those people would meet a
 * refusal at the moment they clicked the link. The refusal would land on the
 * person with the least context and the least power to fix it. Counting the
 * invitation moves it to the administrator who caused it.
 *
 * `suspended` does not: a leaver stops costing money on the day they leave,
 * not at the next billing cycle, and their rows stay for authorship.
 */
const SEAT_STATUSES = ["active", "invited"] as const;

/**
 * How many seats a workspace is using.
 *
 * Humans only. A guest is not a seat, so sharing is never a decision about
 * money and a support session costs the customer nothing. An agent is not a
 * seat, so the Coach and the Champion are not billed for. A placeholder is
 * nobody.
 */
export async function countSeats(
  pool: Pool,
  workspaceId: string,
): Promise<number> {
  const db = drizzle(pool);
  const [row] = await withWorkspace(db, workspaceId, (tx) =>
    tx
      .select({ n: count() })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.kind, "human"),
            inArray(workspaceMembers.status, [...SEAT_STATUSES]),
          ),
        ),
      ),
  );
  return row?.n ?? 0;
}

export interface SeatState {
  /** Null when the instance is not a cloud, or the plan is unlimited. */
  readonly limit: number | null;
  readonly used: number;
  readonly full: boolean;
}

/**
 * What the seat check answers.
 *
 * **A null limit is the whole of the self-hosted path.** There is no
 * `tenants` row on a self-hosted instance, so `readTenant` returns nothing
 * and this returns unlimited, with no second code path and no flag threaded
 * through the funnel.
 */
export async function seatState(
  pool: Pool,
  workspaceId: string,
): Promise<SeatState> {
  const tenant = await readTenant(pool, workspaceId);
  const limit = tenant?.seats ?? null;
  const used = await countSeats(pool, workspaceId);
  return { limit, used, full: limit !== null && used >= limit };
}

/**
 * The catalogue an operator configured, or an empty one.
 *
 * Parsed on the way out, so a hand-edited settings row cannot reach a screen
 * as something the rest of the code does not expect. A catalogue that fails
 * to parse reads as no catalogue rather than throwing: a typo in a plan
 * definition should not take a billing screen down.
 */
export async function readPlans(pool: Pool): Promise<readonly Plan[]> {
  const stored = await readSetting(pool, CLOUD_PLANS_KEY);
  const parsed = plansSchema.safeParse(stored ?? []);
  return parsed.success ? parsed.data : [];
}

/** The usage snapshot, for the customer's own plan screen. */
export async function readOwnUsage(pool: Pool, workspaceId: string) {
  const db = drizzle(pool);
  const [row] = await withWorkspace(db, workspaceId, (tx) =>
    tx
      .select()
      .from(operatorWorkspaceUsage)
      .where(eq(operatorWorkspaceUsage.workspaceId, workspaceId))
      .limit(1),
  );
  return row;
}

/** The drizzle transaction handed to a `withWorkspace` callback. */
type AnyTx = Parameters<Parameters<typeof withWorkspace>[2]>[0];

interface SeatCheck {
  readonly limit: number | null;
  readonly used: number;
}

/**
 * The same question, asked from inside an Operation's own transaction.
 *
 * The enforcement points are both inside one: an invitation is a write and so
 * is joining. Reading the tenant from a second connection would mean the
 * count and the insert could disagree under concurrency, which is exactly how
 * a seat limit gets overshot by one.
 *
 * Returns a null limit on every self-hosted instance, because there is no
 * `tenants` row to read.
 */
async function seatCheckInTx(
  tx: AnyTx,
  workspaceId: string,
): Promise<SeatCheck> {
  const [tenant] = await tx
    .select({ seats: tenants.seats })
    .from(tenants)
    .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)))
    .limit(1);

  if (!tenant?.seats) {
    // No tenant row, or an unlimited plan. Either way there is nothing to
    // count against, so the count is not paid for.
    return { limit: null, used: 0 };
  }

  const [row] = await tx
    .select({ n: count() })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.kind, "human"),
          inArray(workspaceMembers.status, [...SEAT_STATUSES]),
        ),
      ),
    );

  return { limit: tenant.seats, used: row?.n ?? 0 };
}

/**
 * Refuses when there is no room, naming both numbers.
 *
 * Both enforcement points call this rather than comparing for themselves: two
 * comparisons is two answers that can disagree, and the disagreement would
 * show up as an invitation that says it worked and a join that says it did
 * not.
 */
export async function requireSeatInTx(
  tx: AnyTx,
  workspaceId: string,
  message: (used: number, limit: number) => string,
): Promise<void> {
  const { limit, used } = await seatCheckInTx(tx, workspaceId);
  if (limit !== null && used >= limit) {
    throw new OperationError("forbidden", message(used, limit));
  }
}
