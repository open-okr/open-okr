import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A space's holidays, against a real database (METHOD.md §7.4, P9-T19b-a).
 *
 * "A space marks its holiday periods. No check-in is due in them, nobody is
 * nudged for them, the streak does not break." What a holiday period is, and
 * how the streak and the booking read one, is proved in `packages/method`;
 * how a due date moves past one, in the cadence engine's own test. This is
 * the write, the read, and what the write does to goals already open, and
 * the nudge engine's answer on a holiday.
 *
 * Dates are read from the goal the cadence stamped rather than computed here,
 * because the anchor day and the frequency are §11 parameters.
 */

const OWNER = "holiday-owner";
const SUSPENDED = "holiday-suspended";

let workspaceId: string;
let spaceId: string;
let ownerMemberId: string;
let goalId: string;
/** The local date the goal's first check-in falls due. */
let dueOn: string;

const call = async <T>(
  name: string,
  input: unknown,
  userId = OWNER,
): Promise<T> => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId } },
    name as never,
    input as never,
  )) as T;
};

const addDays = (on: string, days: number): string =>
  new Date(Date.parse(`${on}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** The Monday-to-Sunday week holding a date. */
const weekOf = (on: string) => {
  const day = new Date(`${on}T00:00:00Z`).getUTCDay();
  const monday = addDays(on, day === 0 ? -6 : 1 - day);
  return { startsOn: monday, endsOn: addDays(monday, 6) };
};

const nextDueOf = async (id: string): Promise<string> => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ next: string }>(
    "select (next_check_in_at at time zone 'UTC')::date::text as next from goals where id = $1",
    [id],
  );
  return rows[0]?.next as string;
};

const createGoal = async (title: string): Promise<string> => {
  const current = await call<{ id: string }>("cycles.current", {
    mode: "quarterly",
  });
  return (
    await call<{ id: string }>("goals.create", {
      title,
      cycleId: current.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      weight: 1,
    })
  ).id;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Sara Holiday",
      "holiday-owner@example.com",
      SUSPENDED,
      "Suspended",
      "holiday-suspended@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Sara Holiday",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Suspended', 'suspended')`,
    [workspaceId, SUSPENDED],
  );
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  goalId = await createGoal("Product teams ship weekly to every customer");
  dueOn = await nextDueOf(goalId);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("spaces.setHolidays and spaces.holidays", () => {
  it("marks a space's holidays, reads them back in order, and audits the change", async () => {
    await call("spaces.setHolidays", {
      id: spaceId,
      holidays: [
        { startsOn: "2026-08-17", endsOn: "2026-08-23" },
        { startsOn: "2026-08-10", endsOn: "2026-08-16", label: "Summer" },
      ],
    });
    expect(await call("spaces.holidays", { id: spaceId })).toEqual([
      { startsOn: "2026-08-10", endsOn: "2026-08-16", label: "Summer" },
      { startsOn: "2026-08-17", endsOn: "2026-08-23", label: null },
    ]);

    const wb = await workerDb();
    const audit = await wb.admin.query<{ action: string; actor: string }>(
      `select action, actor_member_id as actor from audit_events
        where workspace_id = $1 and action = 'spaces.setHolidays'`,
      [workspaceId],
    );
    expect(audit.rows).toEqual([
      { action: "spaces.setHolidays", actor: ownerMemberId },
    ]);
  });

  it("replaces the list whole, so a holiday taken off is gone", async () => {
    await call("spaces.setHolidays", {
      id: spaceId,
      holidays: [{ startsOn: "2026-08-10", endsOn: "2026-08-16" }],
    });
    await call("spaces.setHolidays", { id: spaceId, holidays: [] });
    expect(await call("spaces.holidays", { id: spaceId })).toEqual([]);
  });

  it("refuses a holiday that ends before it starts", async () => {
    await expect(
      call("spaces.setHolidays", {
        id: spaceId,
        holidays: [{ startsOn: "2026-08-16", endsOn: "2026-08-10" }],
      }),
    ).rejects.toThrow();
  });

  it("is refused to a suspended member, as not found", async () => {
    await expect(
      call("spaces.holidays", { id: spaceId }, SUSPENDED),
    ).rejects.toThrow();
    await expect(
      call("spaces.setHolidays", { id: spaceId, holidays: [] }, SUSPENDED),
    ).rejects.toThrow();
  });
});

describe("no check-in is due in a holiday", () => {
  it("moves a goal already open past the holiday it was due in", async () => {
    const result = await call<{ moved: number }>("spaces.setHolidays", {
      id: spaceId,
      holidays: [weekOf(dueOn)],
    });
    expect(result.moved).toBe(1);
    expect(await nextDueOf(goalId)).toBe(addDays(dueOn, 7));
  });

  it("leaves a goal due outside every holiday where it was", async () => {
    const result = await call<{ moved: number }>("spaces.setHolidays", {
      id: spaceId,
      holidays: [weekOf(addDays(dueOn, 14))],
    });
    expect(result.moved).toBe(0);
    expect(await nextDueOf(goalId)).toBe(dueOn);
  });

  it("never stamps a new goal's first check-in inside one", async () => {
    await call("spaces.setHolidays", {
      id: spaceId,
      holidays: [weekOf(dueOn)],
    });
    const second = await createGoal("Every release note reaches the field");
    expect(await nextDueOf(second)).toBe(addDays(dueOn, 7));
  });
});

describe("nobody is nudged for a holiday (acceptance)", () => {
  const runOn = async (on: string) => {
    const wb = await workerDb();
    return callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "nudges.run",
      { now: `${on}T12:00:00Z` },
    );
  };
  const nudgeRows = async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      rule_key: string;
      sent_at: string | null;
      suppressed_reason: string | null;
    }>(
      `select rule_key, sent_at, suppressed_reason from nudges
        where workspace_id = $1 and subject_id = $2`,
      [workspaceId, goalId],
    );
    return rows;
  };

  it("sends nothing on the day a check-in would have been due", async () => {
    await call("spaces.setHolidays", {
      id: spaceId,
      holidays: [weekOf(dueOn)],
    });
    await runOn(dueOn);
    expect(await nudgeRows()).toEqual([]);
  });

  it("records an overdue reminder on a holiday as held back, with its reason", async () => {
    // Overdue from before the holiday: the week before is not one.
    await call("spaces.setHolidays", {
      id: spaceId,
      holidays: [weekOf(dueOn)],
    });
    const wb = await workerDb();
    await wb.admin.query(
      "update goals set next_check_in_at = $2::date + time '12:00' where id = $1",
      [goalId, addDays(dueOn, -7)],
    );
    await runOn(dueOn);
    const rows = await nudgeRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.suppressed_reason).toBe("holiday");
      expect(row.sent_at).toBeNull();
    }
  });
});
