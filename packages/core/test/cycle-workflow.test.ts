import {
  cycleIssues,
  cyclePackItems,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { canonThresholds, phaseWorkAllowed } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  ensurePackItemsInTx,
  evaluateWorkflow,
  loadCycleForWorkflow,
  readPackItems,
  recomputeGateState,
} from "../src/cycles/workflow.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The guided cycle workflow against a real database (P3-T03, METHOD.md §2.3,
 * §4.5).
 *
 * `packages/method/test/workflow.test.ts` proves the rules with no database at
 * all. This file proves the other half: that the snapshot handed to those rules
 * is actually what the rows say, which is the half a pure test cannot check and
 * the half that has broken twice in this repository.
 */

const OWNER = "workflow-owner";

let workspaceId: string;
let cycleId: string;

const thresholds = canonThresholds();

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

async function withTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

/** Runs a write through the pipeline, the way a real action would. */
async function inOperation<T>(
  fn: (
    tx: Parameters<Parameters<typeof runOperation>[1]["execute"]>[0]["tx"],
  ) => Promise<T>,
): Promise<T> {
  const wb = await workerDb();
  return runOperation(
    { pool: wb.appPool },
    {
      action: "test.workflow",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const result = await fn(tx);
        return {
          result,
          activity: {
            kind: "test.workflow",
            subjectType: "cycle",
            subjectId: cycleId,
          },
          audit: { action: "test.workflow", targetType: "cycle" },
        };
      },
    },
  );
}

async function snapshot() {
  return withTx(async (tx) => {
    const cycle = await loadCycleForWorkflow(tx, workspaceId, cycleId);
    if (!cycle) {
      throw new Error("the cycle disappeared");
    }
    return evaluateWorkflow(tx, workspaceId, cycle, thresholds);
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Workflow Owner", "workflow-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Workflow Owner",
  });
  workspaceId = provisioned.workspaceId;

  // Provisioning already created the cycle containing today (P3-T02).
  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = current?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the input pack rows", () => {
  it("are created once, seven of them, in §2.6 order with their own words", async () => {
    await inOperation((tx) => ensurePackItemsInTx(tx, workspaceId, cycleId));
    const items = await withTx((tx) => readPackItems(tx, workspaceId, cycleId));

    expect(items).toHaveLength(7);
    expect(items.map((item) => item.itemKey)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(items[2]?.label).toMatch(/KPI dashboard/);
    expect(items.every((item) => item.gathered === false)).toBe(true);
  });

  it("are not duplicated by a second call", async () => {
    await inOperation((tx) => ensurePackItemsInTx(tx, workspaceId, cycleId));
    await inOperation((tx) => ensurePackItemsInTx(tx, workspaceId, cycleId));
    const items = await withTx((tx) => readPackItems(tx, workspaceId, cycleId));
    expect(items).toHaveLength(7);
  });
});

describe("the snapshot handed to the rules", () => {
  it("reads a fresh cycle as quarterly, unpublished and unprepared", async () => {
    const { input } = await snapshot();
    expect(input.mode).toBe("quarterly");
    expect(input.publishedAt).toBeNull();
    expect(input.sponsorId).toBeNull();
    expect(input.facilitatorId).toBeNull();
    expect(input.hasBaselineHealth).toBe(false);
    expect(input.issues).toEqual([]);
    // Goals do not exist in this build, and the snapshot must say so rather
    // than claim an empty set.
    expect(input.goals).toBeUndefined();
  });

  it("counts issues and reads their impact", async () => {
    await inOperation(async (tx) => {
      for (const impact of [5, 4, 3]) {
        // openokr:allow-mutation: test setup on the transaction this operation
        // opened, the same shape a real action's execute uses.
        await tx
          .insert(cycleIssues)
          .values({ workspaceId, cycleId, text: `Issue ${impact}`, impact });
      }
    });
    const { input } = await snapshot();
    expect(input.issues.map((issue) => issue.impact).sort()).toEqual([3, 4, 5]);
  });

  it("reads a numeric prior score as a number, not a string", async () => {
    // `numeric` comes back from the driver as a string. Compared against null it
    // would make an unscored key result look scored, which is the kind of thing
    // only a real database run finds.
    const wb = await workerDb();
    await wb.admin.query(
      `insert into cycle_prior_scores (id, workspace_id, cycle_id, text, score)
       values (gen_random_uuid(), $1, $2, 'Prior', 0.70)`,
      [workspaceId, cycleId],
    );
    await wb.admin.query(
      `insert into cycle_prior_scores (id, workspace_id, cycle_id, text, score)
       values (gen_random_uuid(), $1, $2, 'Unscored', null)`,
      [workspaceId, cycleId],
    );
    const { input } = await snapshot();
    expect(input.priorScores).toHaveLength(2);
    expect(input.priorScores.map((row) => row.score)).toContain(0.7);
    expect(input.priorScores.map((row) => row.score)).toContain(null);
  });

  it("takes the earliest booked session as the pack lead's reference", async () => {
    await callAction(
      { pool: (await workerDb()).appPool, ...context() },
      "cycles.update",
      {
        id: cycleId,
        sessionDates: [
          { key: "drafting", on: "2026-06-20" },
          { key: "diagnosis", on: "2026-06-10" },
        ],
      },
    );
    const { input } = await snapshot();
    expect(input.firstSessionOn).toBe("2026-06-10");
  });
});

describe("the gate rows", () => {
  it("are six, and record that four cannot be evaluated yet", async () => {
    const { gates } = await snapshot();
    await inOperation((tx) =>
      recomputeGateState(tx, workspaceId, cycleId, gates),
    );

    const wb = await workerDb();
    const rows = await wb.admin.query<{
      gate_key: number;
      passed: boolean;
      evaluable: boolean;
      detail: { blocked?: string };
    }>(
      "select gate_key, passed, evaluable, detail from cycle_gate_state where cycle_id = $1 order by gate_key",
      [cycleId],
    );

    expect(rows.rows).toHaveLength(6);
    // Gates 1, 3, 4 and 5 all read goals, which arrive at P3-T04.
    for (const gateKey of [1, 3, 4, 5]) {
      const row = rows.rows.find((entry) => entry.gate_key === gateKey);
      expect(row?.evaluable, `gate ${gateKey}`).toBe(false);
      expect(row?.detail.blocked).toMatch(/P3-T04/);
    }
    // Gate 2 waits for the quality engine, gate 6 answers today.
    expect(rows.rows.find((entry) => entry.gate_key === 2)?.evaluable).toBe(
      false,
    );
    expect(rows.rows.find((entry) => entry.gate_key === 6)?.evaluable).toBe(
      true,
    );
  });

  it("stay at six across a recompute, updated rather than added to", async () => {
    const first = await snapshot();
    await inOperation((tx) =>
      recomputeGateState(tx, workspaceId, cycleId, first.gates),
    );
    await inOperation((tx) =>
      recomputeGateState(tx, workspaceId, cycleId, first.gates),
    );
    const wb = await workerDb();
    const count = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from cycle_gate_state where cycle_id = $1",
      [cycleId],
    );
    expect(count.rows[0]?.n).toBe(6);
  });

  it("refuse publication while any gate cannot answer", async () => {
    // The safe direction. A cycle in this build can never be publishable,
    // because four of its gates read goals that do not exist, and that is the
    // correct answer rather than a bug to work around.
    const { publishable } = await snapshot();
    expect(publishable).toBe(false);
  });

  it("pass gate 6 once a deadline before day one is set", async () => {
    const before = await snapshot();
    expect(before.gates.find((gate) => gate.gateKey === 6)?.passed).toBe(false);

    const wb = await workerDb();
    const cycle = await withTx((tx) =>
      loadCycleForWorkflow(tx, workspaceId, cycleId),
    );
    const dayBefore = new Date(`${cycle?.startsOn}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 7);
    await callAction({ pool: wb.appPool, ...context() }, "cycles.update", {
      id: cycleId,
      publicationDeadline: dayBefore.toISOString().slice(0, 10),
    });

    const after = await snapshot();
    expect(after.gates.find((gate) => gate.gateKey === 6)?.passed).toBe(true);
  });
});

describe("opening phase 4 against real rows", () => {
  /**
   * The task's acceptance criterion, end to end through the loader rather than
   * against a hand-built snapshot: "Given a quarterly cycle whose input pack has
   * two items missing, when the facilitator opens Phase 4, then drafting is
   * blocked with the two missing items named."
   */
  it("blocks drafting and names the two ungathered items", async () => {
    const wb = await workerDb();
    await inOperation((tx) => ensurePackItemsInTx(tx, workspaceId, cycleId));

    // Everything gathered except items 4 and 6, and the rest of phase 1 met, so
    // the pack is the only thing standing in the way.
    await wb.admin.query(
      "update cycle_pack_items set gathered = true where cycle_id = $1 and item_key not in (4, 6)",
      [cycleId],
    );
    const member = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 limit 1",
      [workspaceId],
    );
    const memberId = member.rows[0]?.id as string;
    await callAction({ pool: wb.appPool, ...context() }, "cycles.update", {
      id: cycleId,
      sponsorId: memberId,
      facilitatorId: memberId,
      sessionDates: [{ key: "drafting", on: "2026-12-18" }],
      firstCycle: true,
    });
    await wb.admin.query(
      "update cycles set pack_distributed_at = '2026-12-07T09:00:00Z' where id = $1",
      [cycleId],
    );

    await wb.admin.query(
      "insert into cycle_baseline_health (cycle_id, workspace_id) values ($1, $2)",
      [cycleId, workspaceId],
    );
    for (const impact of [5, 5, 4, 3, 2]) {
      await wb.admin.query(
        `insert into cycle_issues (id, workspace_id, cycle_id, text, impact)
         values (gen_random_uuid(), $1, $2, 'Issue', $3)`,
        [workspaceId, cycleId, impact],
      );
    }
    await wb.admin.query(
      `insert into cycle_revalidations (cycle_id, workspace_id, holds, focus_note)
       values ($1, $2, true, 'Mobile')`,
      [cycleId, workspaceId],
    );

    const { phases } = await snapshot();
    const outcome = phaseWorkAllowed(4, phases);

    // Phases 2 and 3 are in order, so the pack is the only thing left. The
    // criterion is that the two items are named, and with everything else
    // satisfied they are the whole answer.
    expect(outcome.allowed).toBe(false);
    expect(outcome.because).toHaveLength(2);
    expect(outcome.because[0]).toMatch(/Phase 1.*item 4.*Customer feedback/);
    expect(outcome.because[1]).toMatch(/Phase 1.*item 6.*Committed projects/);
  });

  it("allows drafting once the whole pack is gathered", async () => {
    const wb = await workerDb();
    await inOperation((tx) => ensurePackItemsInTx(tx, workspaceId, cycleId));
    await wb.admin.query(
      "update cycle_pack_items set gathered = true where cycle_id = $1",
      [cycleId],
    );
    const member = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 limit 1",
      [workspaceId],
    );
    const memberId = member.rows[0]?.id as string;
    await callAction({ pool: wb.appPool, ...context() }, "cycles.update", {
      id: cycleId,
      sponsorId: memberId,
      facilitatorId: memberId,
      sessionDates: [{ key: "drafting", on: "2026-12-18" }],
      firstCycle: true,
    });
    await wb.admin.query(
      "update cycles set pack_distributed_at = '2026-12-07T09:00:00Z' where id = $1",
      [cycleId],
    );
    await wb.admin.query(
      "insert into cycle_baseline_health (cycle_id, workspace_id) values ($1, $2)",
      [cycleId, workspaceId],
    );
    for (const impact of [5, 5, 4, 3, 2]) {
      await wb.admin.query(
        `insert into cycle_issues (id, workspace_id, cycle_id, text, impact)
         values (gen_random_uuid(), $1, $2, 'Issue', $3)`,
        [workspaceId, cycleId, impact],
      );
    }
    await wb.admin.query(
      `insert into cycle_revalidations (cycle_id, workspace_id, holds, focus_note)
       values ($1, $2, true, 'Mobile')`,
      [cycleId, workspaceId],
    );

    const { phases } = await snapshot();
    expect(phases[1]?.state).toBe("pass");
    expect(phases[2]?.state).toBe("pass");
    expect(phases[3]?.state).toBe("pass");
    expect(phaseWorkAllowed(4, phases).allowed).toBe(true);
  });
});

describe("the workflow actions", () => {
  it("recomputes the gate rows on a pack-item write, without being asked", async () => {
    const wb = await workerDb();
    // No gate rows exist until something writes. One ordinary workflow write is
    // what §4.3's "recomputed on every relevant write" means.
    const before = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from cycle_gate_state where cycle_id = $1",
      [cycleId],
    );
    expect(before.rows[0]?.n).toBe(0);

    await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.setPackItem",
      { cycleId, itemKey: 3, gathered: true },
    );

    const after = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from cycle_gate_state where cycle_id = $1",
      [cycleId],
    );
    expect(after.rows[0]?.n).toBe(6);
  });

  it("reads the phases, the gates and the pack in one call", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "workflow.addIssue", {
      cycleId,
      text: "Onboarding drops half of new sign-ups",
      impact: 5,
      source: "manual",
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.read",
      { cycleId },
    );
    expect(read.phases).toHaveLength(8);
    expect(read.gates).toHaveLength(6);
    expect(read.packItems).toHaveLength(7);
    expect(read.issues[0]?.impact).toBe(5);
    expect(read.publishable).toBe(false);
  });

  it("refuses to publish while a gate cannot be evaluated, and says which", async () => {
    // The guard that matters most: a set must never publish through a gate that
    // is red or cannot answer. Four of them read goals, which do not exist yet.
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "workflow.publish", {
        cycleId,
      }),
    ).rejects.toThrow(/all six gates are green/i);
  });

  it("names the blocked gates in the refusal rather than failing silently", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "workflow.publish", {
      cycleId,
    }).catch((error: unknown) => {
      expect(String(error)).toMatch(/P3-T04/);
    });
  });

  it("refuses a change to a revalidation marked as changed with no note", async () => {
    // §2.1: the frame is revalidated, never rewritten. A change with no note is
    // a rewrite nobody recorded.
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context() },
        "workflow.setRevalidation",
        {
          cycleId,
          holds: false,
          changed: true,
        },
      ),
    ).rejects.toThrow();
  });

  it("accepts a revalidation that holds, and phase 3 then passes", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.setRevalidation",
      { cycleId, holds: true, changed: false, focusNote: "Mobile activation" },
    );
    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.read",
      { cycleId },
    );
    expect(read.phases[3]?.state).toBe("pass");
  });

  it("allows one calibration and refuses the second in words", async () => {
    // §7.6 allows one. The unique index would refuse the second anyway; the
    // action turns a constraint violation into a sentence somebody can read.
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "workflow.calibrate", {
      cycleId,
      reason: "The market moved under the set",
    });
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "workflow.calibrate", {
        cycleId,
        reason: "Again",
      }),
    ).rejects.toThrow(/already been calibrated/i);
  });

  it("promotes an issue into a priority in one write", async () => {
    const wb = await workerDb();
    const issue = await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.addIssue",
      {
        cycleId,
        text: "Support cost per ticket is climbing",
        impact: 4,
        source: "manual",
      },
    );
    const priority = await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.addPriority",
      {
        cycleId,
        text: "Make support cheaper per ticket",
        successStatement: "Cost per ticket down a third by year end",
        fromIssueId: issue.id,
      },
    );

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "workflow.read",
      { cycleId },
    );
    expect(read.priorities).toHaveLength(1);
    expect(
      read.issues.find((entry) => entry.id === issue.id)?.promotedToPriorityId,
    ).toBe(priority.id);
  });
});

describe("the pack items table itself", () => {
  it("refuses a second row for the same item", async () => {
    await inOperation((tx) => ensurePackItemsInTx(tx, workspaceId, cycleId));
    const wb = await workerDb();
    await expect(
      wb.admin.query(
        `insert into cycle_pack_items (id, workspace_id, cycle_id, item_key)
         values (gen_random_uuid(), $1, $2, 3)`,
        [workspaceId, cycleId],
      ),
    ).rejects.toThrow();
    void cyclePackItems;
  });
});
