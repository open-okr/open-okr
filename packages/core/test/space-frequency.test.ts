import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A space's own check-in frequency (METHOD.md §7.1, §11, P9-T19a-d-a).
 *
 * The space has stored it since P6-G18b and nothing read it, so a team that
 * set every two weeks went on being asked every week. A goal created in the
 * space now takes it, and a change to it moves the open goals that were
 * following it, with their next due date counted from the new frequency.
 */

const OWNER = "frequency-owner";

let workspaceId: string;
let ownerMemberId: string;
let spaceId: string;
let cycleId: string;

const call = async <T>(name: string, input: unknown): Promise<T> =>
  (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  )) as T;

const goalIn = async (title: string) =>
  (
    await call<{ id: string }>("goals.create", {
      title,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      weight: 1,
    })
  ).id;

const rowOf = async (goalId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    check_in_frequency: string | null;
    next_check_in_at: Date | null;
  }>("select check_in_frequency, next_check_in_at from goals where id = $1", [
    goalId,
  ]);
  return rows[0];
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Daniel", `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Daniel",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  cycleId = (
    (await call<{ id: string }>("cycles.current", { mode: "quarterly" })) ?? {
      id: "",
    }
  ).id;
  // Quiet hours off, so a nudge is recorded at whatever hour the run is told.
  await wb.admin.query(
    "update workspace_members set quiet_hours = null where workspace_id = $1",
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a goal in the space", () => {
  it("takes the space's frequency when it is created", async () => {
    await call("spaces.updateSettings", {
      id: spaceId,
      defaultCheckInFrequency: "biweekly",
    });
    const goalId = await goalIn("Win the late-stage deals against Brightline");
    expect((await rowOf(goalId))?.check_in_frequency).toBe("biweekly");
  });

  it("follows the workspace while the space has chosen nothing", async () => {
    const goalId = await goalIn("Sell to accounts that can onboard themselves");
    expect((await rowOf(goalId))?.check_in_frequency).toBeNull();
  });
});

describe("a change to the space's frequency", () => {
  it("moves the open goals following it, and leaves one set apart", async () => {
    const following = await goalIn("Win the late-stage deals");
    const setApart = await goalIn("Keep the pipeline honest");
    await call("goals.update", { id: setApart, checkInFrequency: "monthly" });

    await call("spaces.updateSettings", {
      id: spaceId,
      defaultCheckInFrequency: "biweekly",
    });
    expect((await rowOf(following))?.check_in_frequency).toBe("biweekly");
    expect((await rowOf(setApart))?.check_in_frequency).toBe("monthly");

    // And back: a space that follows the workspace again takes its goals
    // with it.
    await call("spaces.updateSettings", {
      id: spaceId,
      defaultCheckInFrequency: null,
    });
    expect((await rowOf(following))?.check_in_frequency).toBeNull();
    expect((await rowOf(setApart))?.check_in_frequency).toBe("monthly");
  });
});

describe("the in-between week", () => {
  /**
   * P9-T19a-d-a's acceptance criterion: "Given a space set to every two
   * weeks, when a week passes without a check-in, then nobody is nudged."
   */
  it("acceptance: a space on every two weeks is not nudged in the week between", async () => {
    await call("spaces.updateSettings", {
      id: spaceId,
      defaultCheckInFrequency: "biweekly",
    });
    const goalId = await goalIn("Win the late-stage deals against Brightline");
    const draft = await call<{ id: string }>("goals.startCheckIn", { goalId });
    await call("goals.publishCheckIn", {
      id: draft.id,
      status: "on_track",
      confidence: 0.6,
      narrative: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Two deals moved to legal." }],
          },
        ],
      },
      values: [],
    });

    const due = (await rowOf(goalId))?.next_check_in_at as Date;
    // Two weeks on, not one.
    expect(due.getTime() - Date.now()).toBeGreaterThan(8 * 86_400_000);

    // A week before that due date is the in-between week's anchor day.
    await call("agents.runChampion", {
      now: new Date(due.getTime() - 7 * 86_400_000).toISOString(),
      cadence: "hourly",
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select rule_key from nudges
        where workspace_id = $1 and subject_id = $2 and rule_key like 'checkin.%'`,
      [workspaceId, goalId],
    );
    expect(rows).toEqual([]);
  });
});
