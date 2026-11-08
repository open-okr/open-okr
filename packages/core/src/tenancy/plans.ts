/**
 * Plans and seats (P8-T05).
 *
 * Design: `docs/design/plans-and-seats.md`.
 *
 * **There is no field here that can name a feature, and there will not be
 * one.** REQUIREMENTS §5 says self-host is never feature-gated and PLAN.md §4
 * says the managed cloud sells operation rather than features. A plan that
 * can turn a feature off is how that stops being true, and the way it arrives
 * is an empty list somebody adds "for later". A plan is a seat count, an AI
 * allowance and its prices, and that is the whole of it.
 *
 * **The catalogue is an instance setting, not a table.** It is operator
 * configuration for one deployment, it changes rarely, and it has no
 * per-tenant rows. Adding a plan is an edit rather than a migration.
 */
import {
  activeOnly,
  inviteLinks,
  operatorWorkspaceUsage,
  tenants,
  users,
  withWorkspace,
  workspaceMembers,
  workspaceRoles,
} from "@openokr/db";
import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { PROTECTED_ROLE_KEY } from "../access/roles.ts";
import { OperationError } from "../operations/errors.ts";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting } from "../secrets/instance-settings.ts";
import { listMembershipsForUser } from "../workspaces/memberships.ts";
import { isCloudEnabled } from "./settings.ts";
import { readTenant, setTenantPlanInTx } from "./store.ts";

const CLOUD_PLANS_KEY = "cloud.plans";
const CLOUD_DEFAULT_PLAN_KEY = "cloud.defaultPlan";
const FREE_WORKSPACES_KEY = "cloud.limits.freeWorkspacesPerPerson";

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
  /**
   * AI credits a month on the provider's own key. Absent or zero means the workspace
   * brings its own (docs/design/ai-credits.md §3).
   */
  aiCredits: z.number().int().min(0).optional(),
  /** Whether this plan can buy more credits. */
  aiTopUps: z.boolean().optional(),
  /**
   * A payment provider's price identifiers, and no amounts: the provider holds
   * those, because each provider sets its own prices and currency. A plan with none
   * cannot be bought, only set by an operator (docs/design/billing.md §3).
   */
  prices: z
    .object({
      month: z.string().trim().min(1).optional(),
      year: z.string().trim().min(1).optional(),
    })
    .optional(),
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
 * The personal invitations still waiting for somebody, each of which holds a
 * seat (plans-and-seats.md §2).
 *
 * **A personal invitation writes a link and no member until it is accepted**,
 * so the `invited` status above was never written by anything, and with seats
 * free any number of invitations succeeded. The link is what holds the seat,
 * from the moment it is sent until it is accepted, revoked or expires.
 *
 * - A guest's invitation is not a seat, as a guest is not.
 * - One seat per address, however many times that person was asked.
 * - None for an address somebody here already has: accepting changes nothing.
 *   A placeholder, an import's waiting row or the owner an operator's new
 *   workspace waits for, is not a seat itself, so its invitation is the seat.
 * - None for `arriving`, the address being admitted now: the seat its
 *   invitation holds is the one that person is about to take.
 */
function pendingInvitations(workspaceId: string, arriving?: string): SQL {
  return and(
    eq(inviteLinks.workspaceId, workspaceId),
    eq(inviteLinks.mode, "personal"),
    eq(inviteLinks.memberKind, "human"),
    isNotNull(inviteLinks.email),
    isNull(inviteLinks.memberId),
    isNull(inviteLinks.revokedAt),
    or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, sql`now()`)),
    or(
      isNull(inviteLinks.maxUses),
      lt(inviteLinks.useCount, inviteLinks.maxUses),
    ),
    arriving === undefined
      ? undefined
      : sql`lower(${inviteLinks.email}) <> lower(${arriving})`,
    sql`not exists (
      select 1 from ${workspaceMembers}
        left join ${users} on ${users.id} = ${workspaceMembers.userId}
       where ${workspaceMembers.workspaceId} = ${inviteLinks.workspaceId}
         and ${workspaceMembers.deletedAt} is null
         and ${workspaceMembers.kind} <> 'placeholder'
         and (lower(${users.email}) = lower(${inviteLinks.email})
              or lower(${workspaceMembers.placeholderEmail}) = lower(${inviteLinks.email})))`,
  ) as SQL;
}

async function pendingInvitationCountInTx(
  tx: AnyTx,
  workspaceId: string,
  arriving?: string,
): Promise<number> {
  const [row] = await tx
    .select({
      n: sql<number>`count(distinct lower(${inviteLinks.email}))::int`,
    })
    .from(inviteLinks)
    .where(activeOnly(inviteLinks, pendingInvitations(workspaceId, arriving)));
  return row?.n ?? 0;
}

/**
 * How many people a workspace has: the headcount a smaller plan is judged by.
 *
 * Humans only. A guest is not a seat, so sharing is never a decision about
 * money and a support session costs the customer nothing. An agent is not a
 * seat, so the Coach and the Champion are not billed for. A placeholder is
 * nobody. **Pending invitations are not counted here**: a plan that fits the
 * people takes nobody's access away, and whoever arrives without a seat is
 * refused at the funnel. `seatState` adds them, for the seats that are held.
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
  const pending = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    pendingInvitationCountInTx(tx, workspaceId),
  );
  const used = (await countSeats(pool, workspaceId)) + pending;
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
  const parsed = plansSchema.safeParse(stored ?? plansFromEnvironment());
  return parsed.success ? parsed.data : [];
}

/**
 * Whether Plan and seats exists on this instance.
 *
 * With the flag off, or with no plans to read, it does not. A group runs with the
 * flag on and an empty catalogue, and a screen implying a paid version of what it
 * runs would not be true (`docs/design/hosting-profiles.md` §5).
 */
export async function hasPlanScreen(pool: Pool): Promise<boolean> {
  return (await isCloudEnabled(pool)) && (await readPlans(pool)).length > 0;
}

/**
 * \`OPENOKR_CLOUD_PLANS\`, the bootstrap for a deployment that has no stored
 * catalogue (UAT BUG-022). Nothing wrote \`cloud.plans\` and nothing documented
 * it, so an operator could offer no plan but Free. A stored catalogue still
 * wins, as every instance setting's stored value does.
 */
function plansFromEnvironment(): unknown {
  const definition = getInstanceSetting(CLOUD_PLANS_KEY);
  const raw = definition
    ? environmentValue(definition, process.env)
    : undefined;
  if (typeof raw !== "string" || raw.trim() === "") {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * The plan a new workspace starts on, or none.
 *
 * **Empty is the default, and it changes nothing**: a new workspace has no plan
 * and no seat limit, which is what every group and every single organisation
 * needs. A provider names its free plan here, which is what makes "Free" mean
 * ten people rather than unlimited.
 *
 * A key the catalogue does not hold reads as none. The alternative is refusing
 * every sign-up over a typo in a setting.
 */
export async function resolveDefaultPlan(pool: Pool): Promise<Plan | null> {
  const definition = getInstanceSetting(CLOUD_DEFAULT_PLAN_KEY);
  const stored = await readSetting(pool, CLOUD_DEFAULT_PLAN_KEY);
  const key =
    stored ?? (definition && environmentValue(definition, process.env));
  if (typeof key !== "string" || key.trim() === "") {
    return null;
  }
  return (await readPlans(pool)).find((plan) => plan.key === key) ?? null;
}

/**
 * How many free workspaces one person may own (docs/design/hosting-profiles.md §3).
 *
 * Each one is worth AI credits, so without this a free plan is as much AI as
 * somebody cares to ask for. It only means anything with a default plan, which
 * is why a group, which has none, is never limited.
 */
export async function requireFreeWorkspaceRoom(
  pool: Pool,
  userId: string,
): Promise<void> {
  const plan = await resolveDefaultPlan(pool);
  if (!plan) {
    return;
  }
  const definition = getInstanceSetting(FREE_WORKSPACES_KEY);
  const stored = await readSetting(pool, FREE_WORKSPACES_KEY);
  const fromVariable = definition
    ? environmentValue(definition, process.env)
    : undefined;
  const limit = Number(stored ?? fromVariable ?? definition?.fallback ?? 1);
  if (!(limit > 0)) {
    return;
  }

  let owned = 0;
  for (const { workspaceId, memberId } of await listMembershipsForUser(
    pool,
    userId,
  )) {
    const [row] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
      tx
        .select({ id: workspaceRoles.id })
        .from(workspaceMembers)
        .innerJoin(
          workspaceRoles,
          eq(workspaceRoles.id, workspaceMembers.roleId),
        )
        .innerJoin(
          tenants,
          eq(tenants.workspaceId, workspaceMembers.workspaceId),
        )
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, memberId),
            eq(workspaceRoles.builtinKey, PROTECTED_ROLE_KEY),
            eq(tenants.planKey, plan.key),
          ),
        )
        .limit(1),
    );
    if (row) {
      owned += 1;
    }
  }
  if (owned >= limit) {
    throw new OperationError(
      "forbidden",
      `You already own ${owned} free workspace${owned === 1 ? "" : "s"}, which is the limit here. Move one to a paid plan to start another.`,
    );
  }
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
  arriving?: string,
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

  const pending = await pendingInvitationCountInTx(tx, workspaceId, arriving);
  return { limit: tenant.seats, used: (row?.n ?? 0) + pending };
}

/**
 * Refuses when there is no room, naming both numbers.
 *
 * Both enforcement points call this rather than comparing for themselves: two
 * comparisons is two answers that can disagree, and the disagreement would
 * show up as an invitation that says it worked and a join that says it did
 * not.
 *
 * `arriving` is the address being invited or admitted, whose own pending
 * invitation is the seat they would take rather than one in the way.
 */
export async function requireSeatInTx(
  tx: AnyTx,
  workspaceId: string,
  message: (used: number, limit: number) => string,
  options: { readonly arriving?: string } = {},
): Promise<void> {
  const { limit, used } = await seatCheckInTx(
    tx,
    workspaceId,
    options.arriving,
  );
  if (limit !== null && used >= limit) {
    throw new OperationError("forbidden", message(used, limit));
  }
}

/**
 * How many people a workspace has, from inside an Operation's own transaction:
 * the headcount `countSeats` gives, with no pending invitation in it.
 */
export async function seatsInUseInTx(
  tx: AnyTx,
  workspaceId: string,
): Promise<number> {
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
  return row?.n ?? 0;
}

export interface ApplyPlanInput {
  readonly workspaceId: string;
  /** Null is the free tier, which needs no catalogue row. */
  readonly plan: Plan | null;
  /** An operator's own seat count, overriding the plan's. */
  readonly seats?: number | null;
}

/**
 * Puts a workspace on a plan (completeness review H-21).
 *
 * Nothing wrote `plan_key` or `seats` after a tenant was created, so no seat
 * limit ever applied to anybody. Everything that changes a plan comes through
 * here, so the rule cannot differ between them:
 *
 * - **Never below the headcount.** Refused naming both numbers, because the
 *   product never picks who loses access (UIUX-PLAN S-49).
 *
 * Returns false when the workspace has no tenant row, which is every
 * self-hosted instance.
 */
export async function applyPlanInTx(
  tx: AnyTx,
  input: ApplyPlanInput,
): Promise<boolean> {
  const seats =
    input.seats !== undefined ? input.seats : (input.plan?.seats ?? null);
  if (seats !== null) {
    const used = await seatsInUseInTx(tx, input.workspaceId);
    if (used > seats) {
      throw new OperationError(
        "forbidden",
        `That plan has ${seats} seat(s) and ${used} are in use. Free ${used - seats} first: the product never chooses who loses access.`,
      );
    }
  }

  const moved = await setTenantPlanInTx(tx, {
    workspaceId: input.workspaceId,
    planKey: input.plan?.key ?? null,
    seats,
  });
  if (!moved) {
    return false;
  }

  return true;
}

/** One plan from the catalogue by its key, or a refusal that says so. */
export async function planByKey(
  pool: Pool,
  planKey: string | null,
): Promise<Plan | null> {
  if (planKey === null) {
    return null;
  }
  const plan = (await readPlans(pool)).find((entry) => entry.key === planKey);
  if (!plan) {
    throw new OperationError(
      "not_found",
      `There is no plan called "${planKey}" in this instance's catalogue.`,
    );
  }
  return plan;
}

/**
 * The plan this workspace is on, for its own S-49. Null on a self-hosted
 * instance, which has no tenant row.
 */
export async function readOwnPlan(
  pool: Pool,
  workspaceId: string,
): Promise<{ readonly planKey: string | null } | null> {
  const tenant = await readTenant(pool, workspaceId);
  return tenant ? { planKey: tenant.planKey } : null;
}

export interface SeatHolder {
  /** The member's id, or the invitation's for somebody not here yet. */
  readonly id: string;
  /** The member's name, or the invited address. */
  readonly name: string;
  readonly status: (typeof SEAT_STATUSES)[number];
}

/**
 * Who holds the seats `seatState` counts, by the same rule, so the list and
 * the number beside it cannot disagree (completeness review H-21). An
 * administrator told to free a seat needs to see whose it is, including an
 * invitation they can revoke.
 */
export async function listSeatHolders(
  pool: Pool,
  workspaceId: string,
): Promise<readonly SeatHolder[]> {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, async (tx) => {
    const members = (await tx
      .select({
        id: workspaceMembers.id,
        name: workspaceMembers.name,
        status: workspaceMembers.status,
      })
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
      )) as SeatHolder[];
    const invitations = await tx
      .select({ id: inviteLinks.id, email: inviteLinks.email })
      .from(inviteLinks)
      .where(activeOnly(inviteLinks, pendingInvitations(workspaceId)))
      .orderBy(inviteLinks.createdAt);
    // One holder per address, as the count has one seat per address.
    const byAddress = new Map<string, SeatHolder>();
    for (const invitation of invitations) {
      const email = invitation.email ?? "";
      if (!byAddress.has(email.toLowerCase())) {
        byAddress.set(email.toLowerCase(), {
          id: invitation.id,
          name: email,
          status: "invited",
        });
      }
    }
    return [...members, ...byAddress.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  });
}
