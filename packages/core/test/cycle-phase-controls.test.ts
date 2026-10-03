import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { richTextFromPlainText } from "../src/rich-text/from-text.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The phase 1, 2, 3 and 5 writes a screen can now reach, read back by
 * `workflow.read` (completeness review H-09).
 *
 * Four writes had no browser caller and the focus key results had no write at
 * all, so phases 1 to 3 and gate 5 could not go green from the browser. The
 * year a quarter focuses inside is read by the calendar: `cycles.frame_id` was
 * never written, so the old reading found no annual key results anywhere.
 */

const OWNER = "phase-owner";

let workspaceId: string;
let ownerMemberId: string;
let quarterId: string;
let yearId: string;
let annualKeyResultIds: string[];

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const call = async (
  name: Parameters<typeof callAction>[1],
  input: unknown,
): Promise<unknown> => {
  const wb = await workerDb();
  // The registry types each input by its action's literal name, and these
  // tests call several through one helper.
  return callAction({ pool: wb.appPool, ...context() }, name, input as never);
};

type Read = {
  sponsor: { id: string; name: string } | null;
  sessionDates: { key: string; on: string }[];
  baselineHealth: {
    stable: string | null;
    declining: string | null;
    businessAsUsual: string | null;
  } | null;
  focus: { chosen: string[]; candidates: { id: string; title: string }[] };
  capacityCuts: string | null;
  phases: { phase: number; missing: string[] }[];
};

const read = async (cycleId = quarterId) =>
  (await call("workflow.read", { cycleId })) as Read;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2)",
    [OWNER, "phase-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Phase Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  quarterId = (
    (await call("cycles.create", { on: "2030-02-15" })) as {
      id: string;
    }
  ).id;
  yearId = (
    (await call("cycles.create", {
      on: "2030-06-01",
      cadence: "annual",
    })) as { id: string }
  ).id;
  const annualGoal = (await call("goals.create", {
    title: "Become the platform mid-market teams choose first",
    cycleId: yearId,
    level: "company",
    ownerKind: "workspace",
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    weight: 1,
  })) as { id: string };
  annualKeyResultIds = [];
  for (const title of [
    "Grow mid-market ARR from 4m to 9m",
    "Raise activation from 41% to 60%",
  ]) {
    annualKeyResultIds.push(
      (
        (await call("goals.addKeyResult", {
          goalId: annualGoal.id,
          title,
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 1,
          targetValue: 2,
          weight: 1,
        })) as { id: string }
      ).id,
    );
  }
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a quarter's focus key results", () => {
  it("offers the year's key results, and phase 3 asks for a choice among them", async () => {
    const before = await read();
    expect(before.focus.candidates.map((row) => row.id).sort()).toEqual(
      [...annualKeyResultIds].sort(),
    );
    expect(before.phases[3]?.missing).toContain(
      "No focus key results chosen for this quarter",
    );

    await call("workflow.setFocusKeyResults", {
      cycleId: quarterId,
      keyResultIds: [annualKeyResultIds[0]],
    });
    const after = await read();
    expect(after.focus.chosen).toEqual([annualKeyResultIds[0]]);
    expect(after.phases[3]?.missing).not.toContain(
      "No focus key results chosen for this quarter",
    );

    // Saved as what is ticked: an empty choice clears it.
    await call("workflow.setFocusKeyResults", {
      cycleId: quarterId,
      keyResultIds: [],
    });
    expect((await read()).focus.chosen).toEqual([]);
  });

  it("refuses a key result that is not the year's own", async () => {
    await expect(
      call("workflow.setFocusKeyResults", {
        cycleId: quarterId,
        keyResultIds: [crypto.randomUUID()],
      }),
    ).rejects.toThrow(/year's own key results/);
  });

  it("refuses on an annual cycle", async () => {
    await expect(
      call("workflow.setFocusKeyResults", {
        cycleId: yearId,
        keyResultIds: [],
      }),
    ).rejects.toThrow(/annual cycle/);
  });
});

describe("the phase 1 roles and dates", () => {
  it("names a sponsor and books the planning sessions", async () => {
    await call("cycles.update", {
      id: quarterId,
      sponsorId: ownerMemberId,
      sessionDates: [{ key: "diagnose", on: "2029-12-08" }],
    });
    const after = await read();
    expect(after.sponsor?.id).toBe(ownerMemberId);
    expect(after.sessionDates).toEqual([{ key: "diagnose", on: "2029-12-08" }]);
  });

  it("refuses an agent as the facilitator", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ member_id: string }>(
      "select member_id from agents where workspace_id = $1 limit 1",
      [workspaceId],
    );
    await expect(
      call("cycles.update", {
        id: quarterId,
        facilitatorId: rows[0]?.member_id,
      }),
    ).rejects.toThrow(/active person/);
  });

  it("refuses a session date that is not a date", async () => {
    await expect(
      call("cycles.update", {
        id: quarterId,
        sessionDates: [{ key: "diagnose", on: "next week" }],
      }),
    ).rejects.toThrow();
  });
});

describe("baseline health and the cuts, read back as the forms show them", () => {
  it("round-trips the three columns and the cuts as plain text", async () => {
    await call("workflow.setBaselineHealth", {
      cycleId: quarterId,
      stable: richTextFromPlainText("Churn holds at 2%"),
      declining: richTextFromPlainText("Activation\n\nand trial conversion"),
      businessAsUsual: null,
    });
    await call("workflow.setCapacityNotes", {
      cycleId: quarterId,
      cuts: richTextFromPlainText("The partner portal waits a quarter"),
    });
    const after = await read();
    expect(after.baselineHealth).toEqual({
      stable: "Churn holds at 2%",
      declining: "Activation\n\nand trial conversion",
      businessAsUsual: null,
    });
    expect(after.capacityCuts).toBe("The partner portal waits a quarter");
    expect(after.phases[2]?.missing).not.toContain(
      "Baseline health is not recorded",
    );
  });
});

describe("a key result's owner and due date", () => {
  it("refuses an owner who is not a member here, and a date that is not one", async () => {
    const goal = (await call("goals.create", {
      title: "Make onboarding the reason new customers stay",
      cycleId: quarterId,
      level: "company",
      ownerKind: "workspace",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    const base = {
      goalId: goal.id,
      title: "Raise activation from 41% to 60%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    };
    await expect(
      call("goals.addKeyResult", { ...base, ownerId: crypto.randomUUID() }),
    ).rejects.toThrow(/key result owner/);
    await expect(
      call("goals.addKeyResult", { ...base, dueOn: "end of quarter" }),
    ).rejects.toThrow();

    const added = (await call("goals.addKeyResult", {
      ...base,
      ownerId: ownerMemberId,
      dueOn: "2030-03-31",
    })) as { id: string };
    await call("goals.updateKeyResult", { id: added.id, dueOn: null });
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select owner_id, due_on from key_results where id = $1",
      [added.id],
    );
    expect(rows[0]).toMatchObject({ owner_id: ownerMemberId, due_on: null });
  });
});

/**
 * REQUIREMENTS §3.1, both directions (P9-T02).
 *
 * Until P9-T02 the cycle screen's drafting refused while an earlier phase was
 * incomplete, and only when the screen set `guided` (completeness review
 * H-09). The phases now guide by default and nothing waits on them, from any
 * caller. A workspace that makes them binding gets the refusal back, from
 * every caller alike, with the reasons and the setting that caused it.
 */
describe("drafting while the earlier phases are incomplete", () => {
  const objective = {
    title: "Make onboarding the reason new customers stay",
    level: "company",
    ownerKind: "workspace",
    weight: 1,
  } as const;
  const keyResultOf = (goalId: string) => ({
    goalId,
    title: "Raise activation from 41% to 60%",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 41,
    targetValue: 60,
    weight: 1,
  });

  it("drafts an objective and a key result on the recommended profile, with or without the old flag", async () => {
    for (const guided of [true, false]) {
      const goal = (await call("goals.create", {
        ...objective,
        cycleId: quarterId,
        championId: ownerMemberId,
        reviewerId: ownerMemberId,
        guided,
      })) as { id: string };
      await expect(
        call("goals.addKeyResult", { ...keyResultOf(goal.id), guided }),
      ).resolves.toBeTruthy();
    }
  });

  it("says on the workflow that drafting is open, and what the phases still miss", async () => {
    const workflow = (await call("workflow.read", { cycleId: quarterId })) as {
      practice: { phaseEnforcement: string };
      drafting: { allowed: boolean; reasons: string[] };
      phases: { phase: number; state: string; missing: string[] }[];
    };
    expect(workflow.practice.phaseEnforcement).toBe("guided");
    expect(workflow.drafting).toEqual({ allowed: true, reasons: [] });
    expect(workflow.phases[1]?.missing.join(" ")).toMatch(/No sponsor named/);
  });

  it("refuses both under binding phases, naming what the earlier phases still need", async () => {
    const goal = (await call("goals.create", {
      ...objective,
      cycleId: quarterId,
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
    })) as { id: string };
    await call("practice.update", {
      overrides: { "phases.enforcement": "binding" },
    });

    await expect(
      call("goals.create", {
        ...objective,
        cycleId: quarterId,
        championId: ownerMemberId,
        reviewerId: ownerMemberId,
      }),
    ).rejects.toThrow(
      /drafts after the planning phases are complete.*Phase 1: No sponsor named/,
    );
    await expect(
      call("goals.addKeyResult", keyResultOf(goal.id)),
    ).rejects.toThrow(/drafts after the planning phases are complete/);

    const workflow = (await call("workflow.read", { cycleId: quarterId })) as {
      drafting: { allowed: boolean; reasons: string[] };
    };
    expect(workflow.drafting.allowed).toBe(false);
    expect(workflow.drafting.reasons[0]).toMatch(/Phase 1: No sponsor named/);
  });

  it("leaves an objective with its own timeframe alone under binding phases", async () => {
    await call("practice.update", {
      overrides: { "phases.enforcement": "binding" },
    });
    await expect(
      call("goals.create", {
        ...objective,
        timeframe: { startsOn: "2030-01-01", endsOn: "2030-06-30" },
        championId: ownerMemberId,
        reviewerId: ownerMemberId,
      }),
    ).resolves.toBeTruthy();
  });

  it("lets an import record objectives under binding phases, because it records history", async () => {
    await call("practice.update", {
      overrides: { "phases.enforcement": "binding" },
    });
    const wb = await workerDb();
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: OWNER },
          bulk: true,
        },
        "goals.create",
        {
          ...objective,
          cycleId: quarterId,
          championId: ownerMemberId,
          reviewerId: ownerMemberId,
        },
      ),
    ).resolves.toBeTruthy();
  });
});

/**
 * METHOD.md §2.3 (P9-T02): "or this is the first cycle, which is inferred
 * when no earlier cycle exists and may be declared". A workspace's first
 * quarter never asks for a prior quarter's scores that cannot exist.
 */
describe("the first cycle is inferred", () => {
  const priorMissing = (phases: { missing: string[] }[]) =>
    (phases[2]?.missing ?? []).some((reason) => /prior cycle/i.test(reason));

  it("asks nothing of a prior cycle when there is none of its mode", async () => {
    // Provisioning made the quarter containing today, which is the earliest
    // quarterly cycle here. Nobody declared it a first cycle.
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string; first_cycle: boolean }>(
      `select id, first_cycle from cycles
        where workspace_id = $1 and mode = 'quarterly' and deleted_at is null
        order by starts_on asc limit 1`,
      [workspaceId],
    );
    const earliest = rows[0];
    expect(earliest?.first_cycle).toBe(false);
    const first = (await call("workflow.read", { cycleId: earliest?.id })) as {
      phases: { missing: string[] }[];
    };
    expect(priorMissing(first.phases)).toBe(false);
  });

  it("asks for the prior cycle's scores once an earlier one exists", async () => {
    const next = (await call("cycles.create", { on: "2030-05-15" })) as {
      id: string;
    };
    const second = (await call("workflow.read", { cycleId: next.id })) as {
      phases: { missing: string[] }[];
    };
    expect(priorMissing(second.phases)).toBe(true);
  });
});
