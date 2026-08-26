/**
 * The diagnostic and the reset decisions (METHOD.md §8.6 and §8.8,
 * p4-t00-session-design.md §4.8 and §4.10, P4-T11c-a).
 *
 * The task's test plan lines this row covers:
 * - the diagnostic verdict matches METHOD.md §8.6 across the three cases
 * - a keep, modify or abandon decision is recorded once per objective
 *
 * **The third test-plan line, "writes back to the goal on close", is not met and
 * these tests say so rather than working around it.** `goals_close_is_complete`
 * (migration 0022) holds that a close carries `closed_at`, `success_status` and
 * `close_decision` together or none of them, so writing the decision alone is
 * refused by the schema, correctly. Closing the objectives from here would mean
 * deriving a success status and inventing a retrospective body for each, because
 * `closeGoalInTx` requires both and stage nine collects neither. The decision
 * lives in `review_decisions` and the integration with `goals.close` is an open
 * question on the P4-T11c-a row.
 *
 * **The verdict is never decided here.** `rhythmDiagnostic` in `packages/method`
 * reads the two §11 thresholds and returns the kind, the diagnosis and the
 * prescription. These tests assert the action stores what the package said, and
 * the package's own tests assert the package matches the document.
 */
import { resolveThresholds, rhythmDiagnostic } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "reset-facilitator";
const MEMBER = "reset-member";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let memberMemberId: string;
let sessionId: string;
let goalId: string;
let firstKeyResultId: string;
let secondKeyResultId: string;

const context = (userId = FACILITATOR) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const call = async (name: string, input: unknown, userId = FACILITATOR) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    name as never,
    input as never,
  );
};

const diagnostic = async (userId = FACILITATOR) =>
  (await call("sessions.diagnostic", { sessionId }, userId)) as {
    cycleScore: number | null;
    rhythmScore: number | null;
    verdict: string | null;
    diagnosis: string | null;
    prescription: string | null;
    recorded: boolean;
    readable: boolean;
  };

const reset = async (userId = FACILITATOR) =>
  (await call("sessions.reset", { sessionId }, userId)) as {
    objectives: {
      goalId: string;
      goalTitle: string;
      score: number | null;
      decision: string | null;
      meaning: string | null;
      why: string | null;
    }[];
    decided: number;
    total: number;
    complete: boolean;
  };

const storedClose = async (goal: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    close_decision: string | null;
    close_reason: string | null;
  }>("select close_decision, close_reason from goals where id = $1", [goal]);
  return rows[0];
};

/** Grades both key results, then answers the survey with the given scores. */
const gradeAndSurvey = async (
  scores: readonly [number, number],
  survey: readonly number[],
) => {
  await call("sessions.scoreKeyResult", {
    sessionId,
    keyResultId: firstKeyResultId,
    score: scores[0],
    reason: "First.",
  });
  await call("sessions.scoreKeyResult", {
    sessionId,
    keyResultId: secondKeyResultId,
    score: scores[1],
    reason: "Second.",
  });
  await call("sessions.submitProcessHealth", {
    sessionId,
    scores: survey.map((score, index) => ({
      statementKey: index + 1,
      score,
    })),
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Facilitator', $2), ($3, 'Member', $4)`,
    [
      FACILITATOR,
      "reset-facilitator@example.com",
      MEMBER,
      "reset-member@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FACILITATOR,
    name: "Facilitator",
  });
  workspaceId = provisioned.workspaceId;
  facilitatorMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = current.id;

  const member = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Member', 'active') returning id`,
    [workspaceId, MEMBER],
  );
  memberMemberId = member.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId,
    memberId: memberMemberId,
    role: "member",
  });

  const goal = (await call("goals.create", {
    title: "Become the platform mid-market teams reach for first",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: facilitatorMemberId,
    reviewerId: facilitatorMemberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;

  const first = (await call("goals.addKeyResult", {
    goalId,
    title: "Raise weekly active teams from 120 to 300 by 31 March",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 120,
    targetValue: 300,
    unit: "teams",
    weight: 1,
  })) as { id: string };
  firstKeyResultId = first.id;

  const second = (await call("goals.addKeyResult", {
    goalId,
    title: "Cut median onboarding from 9 days to 2 days",
    direction: "reduce",
    indicatorType: "lagging",
    baselineValue: 9,
    targetValue: 2,
    unit: "days",
    weight: 1,
  })) as { id: string };
  secondKeyResultId = second.id;

  const session = (await call("sessions.create", {
    spaceId,
    cycleId,
    kind: "quarterly",
    title: "Q1 review",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: facilitatorMemberId,
  })) as { id: string };
  sessionId = session.id;
  await call("sessions.open", { id: sessionId });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the rhythm diagnostic", () => {
  it("is not readable until the room has both numbers", async () => {
    const before = await diagnostic();
    expect(before.readable).toBe(false);
    expect(before.verdict).toBeNull();

    // Graded but not surveyed: §8.6 needs the rhythm score too, and a
    // diagnostic built on a missing answer reads as evidence.
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: firstKeyResultId,
      score: 0.4,
      reason: "Missed.",
    });
    expect((await diagnostic()).readable).toBe(false);
  });

  it("reads results delivered above the cycle threshold, without consulting the rhythm", async () => {
    // §8.6's first row is the whole answer when it holds: a delivered cycle
    // raises a question about ambition rather than about process, so a poor
    // rhythm must not change the verdict.
    await gradeAndSurvey([0.9, 0.9], [1, 1, 1, 1, 1]);
    await call("sessions.recordDiagnostic", { sessionId });

    const status = await diagnostic();
    expect(status.verdict).toBe("results_delivered");
    expect(status.diagnosis).toBe("Results delivered");
    expect(status.prescription).toContain("ambition was set high enough");
  });

  it("reads a strategy or quality problem when the rhythm held and the cycle missed", async () => {
    // Statements 2 and 5 are the rhythm, both at 5, so the rhythm score is 5.0
    // and the cycle score is 0.35.
    await gradeAndSurvey([0.2, 0.5], [1, 5, 1, 1, 5]);
    await call("sessions.recordDiagnostic", { sessionId });

    const status = await diagnostic();
    expect(status.verdict).toBe("strategy_or_quality");
    expect(status.prescription).toContain(
      "Fix the key results before you push the team",
    );
  });

  it("reads a rhythm problem when both are low", async () => {
    await gradeAndSurvey([0.2, 0.5], [1, 1, 1, 1, 1]);
    await call("sessions.recordDiagnostic", { sessionId });

    const status = await diagnostic();
    expect(status.verdict).toBe("rhythm");
    expect(status.prescription).toContain("Restore the weekly check-in");
  });

  it("stores exactly what the method package said, rather than a second opinion", async () => {
    await gradeAndSurvey([0.2, 0.5], [1, 5, 1, 1, 5]);
    await call("sessions.recordDiagnostic", { sessionId });

    const status = await diagnostic();
    const expected = rhythmDiagnostic(0.35, 5, resolveThresholds() as never);
    expect(status.verdict).toBe(expected.kind);
    expect(status.diagnosis).toBe(expected.diagnosis);
    expect(status.prescription).toBe(expected.prescription);
  });

  it("keeps the numbers it was read against, rather than recomputing later", async () => {
    await gradeAndSurvey([0.2, 0.5], [1, 5, 1, 1, 5]);
    await call("sessions.recordDiagnostic", { sessionId });

    // The room corrects a score after reading the diagnostic. The stored record
    // still says what the room was told, because §8.6 calls it the review's most
    // valuable output and the minutes have to show it.
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: firstKeyResultId,
      score: 0.95,
      reason: "Recounted.",
    });

    const status = await diagnostic();
    expect(status.cycleScore).toBeCloseTo(0.35, 10);
    expect(status.verdict).toBe("strategy_or_quality");

    // Reading it again replaces it, so a room that deliberately re-reads gets
    // one answer and not two.
    await call("sessions.recordDiagnostic", { sessionId });
    const after = await diagnostic();
    expect(after.cycleScore).toBeCloseTo(0.725, 10);
    expect(after.verdict).toBe("results_delivered");
  });

  it("refuses to record before both numbers exist", async () => {
    await expect(
      call("sessions.recordDiagnostic", { sessionId }),
    ).rejects.toThrow();
  });
});

describe("keep, modify or abandon", () => {
  it("lists every objective in the review with the meaning of nothing chosen", async () => {
    const status = await reset();
    expect(status.total).toBe(1);
    expect(status.objectives[0]?.goalId).toBe(goalId);
    // Nothing pre-selected. §8.8's "nothing carries over by default" is a
    // practice statement, and a screen that arrives with keep chosen is the
    // default carry-over wearing a decision's clothes.
    expect(status.objectives[0]?.decision).toBeNull();
    expect(status.objectives[0]?.meaning).toBeNull();
    expect(status.decided).toBe(0);
    expect(status.complete).toBe(false);
  });

  it("records a decision with §8.8's meaning and a required why", async () => {
    await call("sessions.decideObjective", {
      sessionId,
      goalId,
      decision: "modify",
      why: "The target moved when the market did. The objective still holds.",
    });

    const status = await reset();
    expect(status.objectives[0]?.decision).toBe("modify");
    // The meaning comes from METHOD.md §8.8, never from this action.
    expect(status.objectives[0]?.meaning).toContain("Adjust the target");
    expect(status.objectives[0]?.why).toContain("market did");
    expect(status.complete).toBe(true);
  });

  it("refuses a decision with no why", async () => {
    // §8.8 asks for "one decision and a one-line why", and a decision nobody
    // explained is the default carry-over the section exists to stop.
    for (const why of ["", "   "]) {
      await expect(
        call("sessions.decideObjective", {
          sessionId,
          goalId,
          decision: "keep",
          why,
        }),
      ).rejects.toThrow();
    }
  });

  it("refuses a decision outside the three", async () => {
    await expect(
      call("sessions.decideObjective", {
        sessionId,
        goalId,
        decision: "postpone",
        why: "There is no fourth way to close it.",
      }),
    ).rejects.toThrow();
  });

  it("replaces the decision rather than keeping a history of opinions", async () => {
    for (const decision of ["keep", "abandon"] as const) {
      await call("sessions.decideObjective", {
        sessionId,
        goalId,
        decision,
        why: `Settled on ${decision}.`,
      });
    }

    const status = await reset();
    expect(status.objectives[0]?.decision).toBe("abandon");
    expect(status.decided).toBe(1);
  });

  it("survives the session close, and leaves the goal untouched", async () => {
    await call("sessions.decideObjective", {
      sessionId,
      goalId,
      decision: "abandon",
      why: "Priority shifted to the enterprise tier.",
    });
    await call("sessions.close", { id: sessionId });

    // The record survives the close, because the minutes read it.
    const status = await reset();
    expect(status.objectives[0]?.decision).toBe("abandon");
    expect(status.objectives[0]?.why).toContain("enterprise tier");

    // **The goal is untouched, and the schema is why.**
    // `goals_close_is_complete` holds that `closed_at`, `success_status` and
    // `close_decision` are present together or not at all, so writing the
    // decision alone is refused. Closing the objective from here would mean
    // deriving a success status and inventing a retrospective body, because
    // `closeGoalInTx` requires both and stage nine collects neither.
    const stored = await storedClose(goalId);
    expect(stored?.close_decision).toBeNull();
    expect(stored?.close_reason).toBeNull();

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ closed_at: string | null }>(
      "select closed_at from goals where id = $1",
      [goalId],
    );
    expect(rows[0]?.closed_at).toBeNull();
  });

  it("records nothing for an objective the room never reached", async () => {
    const second = (await call("goals.create", {
      title: "Make onboarding something a team finishes in one sitting",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: facilitatorMemberId,
      reviewerId: facilitatorMemberId,
      weight: 1,
    })) as { id: string };

    await call("sessions.decideObjective", {
      sessionId,
      goalId,
      decision: "keep",
      why: "Carrying it forward deliberately.",
    });

    const status = await reset();
    expect(status.total).toBe(2);
    expect(status.decided).toBe(1);
    // Not complete, and no default written anywhere. §8.8's "nothing carries
    // over by default" is exactly this: an objective nobody discussed does not
    // acquire a decision.
    expect(status.complete).toBe(false);
    expect(
      status.objectives.find((entry) => entry.goalId === second.id)?.decision,
    ).toBeNull();
  });
});

describe("access", () => {
  it("lets the room decide, because §8.8 closes the cycle together", async () => {
    await call(
      "sessions.decideObjective",
      {
        sessionId,
        goalId,
        decision: "keep",
        why: "The room agreed.",
      },
      MEMBER,
    );
    expect((await reset(MEMBER)).decided).toBe(1);
    expect(memberMemberId).toBeTruthy();
  });

  it("refuses a suspended member", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberMemberId],
    );
    await expect(reset(MEMBER)).rejects.toThrow();
    await expect(diagnostic(MEMBER)).rejects.toThrow();
  });
});
