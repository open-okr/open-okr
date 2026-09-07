/**
 * The monthly review (METHOD.md §7.5, p4-t00-session-design.md §3, P4-T09).
 *
 * The card carries no test plan line, so this is the one the deliverables and
 * the acceptance criterion imply:
 *
 * - a trend is one per objective per review, and recording it twice corrects
 *   it rather than storing two opinions
 * - a decision names the key result or the goal it affects, and naming neither
 *   is refused, because §7.5's whole point is that a decision is attached to
 *   something
 * - the acceptance criterion: a decision recorded against a key result appears
 *   on its goal with the date and the author
 * - the cycle workspace sees every decision in the cycle
 * - a suspended member sees none of it
 *
 * **The trend is a human judgement and stays one.** The read hands back §3.7's
 * signal beside each objective so a facilitator has the numbers in front of
 * them, and never as a pre-selected answer. A test asserts the recorded trend
 * and the computed signal are allowed to disagree.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "monthly-facilitator";
const OUTSIDER = "monthly-outsider";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let outsiderMemberId: string;
let goalId: string;
let keyResultId: string;
let sessionId: string;

const context = (userId = FACILITATOR) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const call = async (name: string, input: unknown, userId = FACILITATOR) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    // The registry is keyed by literal action names; the tests pass them as
    // strings so a new action does not need a type import to be driven.
    name as never,
    input as never,
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)`,
    [
      FACILITATOR,
      "Facilitator",
      "monthly-facilitator@example.com",
      OUTSIDER,
      "Outsider",
      "monthly-outsider@example.com",
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

  const keyResult = (await call("goals.addKeyResult", {
    goalId,
    title: "Raise weekly active teams from 120 to 300 by 31 March",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 120,
    targetValue: 300,
    unit: "teams",
    weight: 1,
  })) as { id: string };
  keyResultId = keyResult.id;

  // **A member simply not in the space is not refused anything here.**
  // P3-T01's `workspace_standard` binding gives every active member `edit` on
  // the whole workspace, recorded as a deliberate decision on the P3-T16 row,
  // so an "outsider" in the ordinary sense does not exist. The refusal that is
  // real is a suspended member, and that is what these tests drive. Asserting
  // the other thing would have written a test that passes for the wrong
  // reason the day somebody tightens the floor.
  const outsider = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Outsider', 'suspended') returning id`,
    [workspaceId, OUTSIDER],
  );
  outsiderMemberId = outsider.rows[0]?.id as string;

  const session = (await call("sessions.create", {
    spaceId,
    cycleId,
    kind: "monthly",
    title: "March monthly review",
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

describe("the monthly review has no stages", () => {
  it("opens straight to running with no stage key", async () => {
    // §3.1 of the design: scheduled -> open -> closed. The weekly session's
    // rail would be the wrong shape here, and a stage key set on a session
    // with no stages would make the screen render one.
    const read = (await call("sessions.read", { id: sessionId })) as {
      state: string;
      stageKey: string | null;
    };
    expect(read.state).toBe("running");
    expect(read.stageKey).toBeNull();
  });
});

describe("sessions.setTrend", () => {
  it("records one trend per objective", async () => {
    await call("sessions.setTrend", {
      sessionId,
      goalId,
      trend: "improving",
    });

    const record = (await call("sessions.monthlyRecord", { sessionId })) as {
      trends: { goalId: string; trend: string; signal: string | null }[];
    };
    expect(record.trends).toHaveLength(1);
    expect(record.trends[0]?.goalId).toBe(goalId);
    expect(record.trends[0]?.trend).toBe("improving");
  });

  it("corrects rather than duplicating when recorded twice", async () => {
    await call("sessions.setTrend", { sessionId, goalId, trend: "flat" });
    await call("sessions.setTrend", { sessionId, goalId, trend: "declining" });

    const record = (await call("sessions.monthlyRecord", { sessionId })) as {
      trends: { trend: string }[];
    };
    // A review holds one opinion per objective. Two rows would leave a reader
    // asking which of them the room actually agreed.
    expect(record.trends).toHaveLength(1);
    expect(record.trends[0]?.trend).toBe("declining");
  });

  it("hands back §3.7's signal without deciding the trend from it", async () => {
    // The key result has not moved, so the signal is red. The facilitator says
    // improving anyway, which is a legitimate thing for a room to conclude:
    // the numbers are behind and the direction has changed. The product
    // records what they said and shows the number beside it.
    await call("sessions.setTrend", { sessionId, goalId, trend: "improving" });

    const record = (await call("sessions.monthlyRecord", { sessionId })) as {
      trends: { trend: string; signal: string | null }[];
    };
    expect(record.trends[0]?.trend).toBe("improving");
    expect(record.trends[0]?.signal).toBe("red");
  });

  it("does not ask for a trend on a closed objective", async () => {
    // A review asks where the work is going, and a finished objective is not
    // going anywhere. Leaving it in would mean a facilitator answering the
    // question for something already scored.
    const before = (await call("sessions.monthlyRecord", { sessionId })) as {
      untrended: { goalId: string }[];
    };
    expect(before.untrended.map((entry) => entry.goalId)).toContain(goalId);

    await call("goals.close", {
      id: goalId,
      successStatus: "achieved",
      closeDecision: "keep",
      retrospectiveBody: {
        type: "doc" as const,
        content: [
          {
            type: "paragraph" as const,
            content: [
              {
                type: "text" as const,
                text: "Delivered early, and the learning is written up.",
              },
            ],
          },
        ],
      },
    });

    const after = (await call("sessions.monthlyRecord", { sessionId })) as {
      untrended: { goalId: string }[];
      trends: { goalId: string }[];
    };
    expect(after.untrended.map((entry) => entry.goalId)).not.toContain(goalId);
    expect(after.trends.map((entry) => entry.goalId)).not.toContain(goalId);
  });

  it("refuses a trend the method does not define", async () => {
    await expect(
      call("sessions.setTrend", { sessionId, goalId, trend: "sideways" }),
    ).rejects.toThrow();
  });

  it("refuses a trend on a session that is not a monthly review", async () => {
    const weekly = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };

    await expect(
      call("sessions.setTrend", {
        sessionId: weekly.id,
        goalId,
        trend: "flat",
      }),
    ).rejects.toThrow(/monthly/i);
  });
});

describe("sessions.recordDecision", () => {
  it("refuses a decision that names nothing", async () => {
    // §7.5: "Every decision names the key result it affects." A decision with
    // no subject is a meeting note, and the log is not a notepad.
    await expect(
      call("sessions.recordDecision", {
        sessionId,
        text: "We will revisit this next month",
      }),
    ).rejects.toThrow();
  });

  it("records a decision against a key result", async () => {
    const decision = (await call("sessions.recordDecision", {
      sessionId,
      keyResultId,
      text: "Move two engineers off billing onto activation until the end of the cycle",
    })) as { id: string };

    const record = (await call("sessions.monthlyRecord", { sessionId })) as {
      decisions: { id: string; keyResultId: string | null }[];
    };
    expect(record.decisions).toHaveLength(1);
    expect(record.decisions[0]?.id).toBe(decision.id);
    expect(record.decisions[0]?.keyResultId).toBe(keyResultId);
  });
});

describe("the acceptance criterion", () => {
  it("shows a decision on the goal it affects, with its date and author", async () => {
    await call("sessions.recordDecision", {
      sessionId,
      keyResultId,
      text: "Move two engineers off billing onto activation until the end of the cycle",
    });

    const decisions = (await call("decisions.forGoal", { goalId })) as {
      text: string;
      at: string;
      authorName: string;
      keyResultId: string | null;
    }[];

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.text).toContain("Move two engineers");
    // The criterion names both, and both come from the row rather than from
    // the reader's clock or the session's facilitator field.
    expect(decisions[0]?.at).toBeTruthy();
    expect(decisions[0]?.authorName).toBe("Facilitator");
    expect(decisions[0]?.keyResultId).toBe(keyResultId);
  });

  it("reaches the goal through its key result, not only when named directly", async () => {
    // The criterion is written about a key result and the surface is the goal
    // page. A query that matched only `goal_id` would pass every other test in
    // this file and fail the one that matters.
    await call("sessions.recordDecision", {
      sessionId,
      goalId,
      text: "Hold the objective as written rather than rewording it mid-cycle",
    });
    await call("sessions.recordDecision", {
      sessionId,
      keyResultId,
      text: "Move two engineers off billing onto activation",
    });

    const decisions = (await call("decisions.forGoal", { goalId })) as {
      id: string;
    }[];
    expect(decisions).toHaveLength(2);
  });
});

describe("the plan's shape, and why it is not the obvious one", () => {
  it("keys the trend on the month, so a second review in March corrects it", async () => {
    // TECHNICAL-PLAN §4.7 keys a trend on (goal, month) rather than on the
    // session. A space that reschedules and ends up holding two reviews in one
    // March has one March opinion per objective, not two.
    await call("sessions.setTrend", { sessionId, goalId, trend: "flat" });

    const second = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "monthly",
      title: "March monthly review, take two",
      // Same month as the first, a fortnight later.
      scheduledFor: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };
    await call("sessions.open", { id: second.id });

    const before = (await call("sessions.monthlyRecord", {
      sessionId: second.id,
    })) as { trends: { trend: string }[] };
    const sameMonth =
      new Date().getMonth() ===
      new Date(Date.now() + 14 * 86_400_000).getMonth();
    if (sameMonth) {
      // The second review opens already knowing what the first concluded.
      expect(before.trends).toHaveLength(1);
      expect(before.trends[0]?.trend).toBe("flat");

      await call("sessions.setTrend", {
        sessionId: second.id,
        goalId,
        trend: "improving",
      });
      const after = (await call("sessions.monthlyRecord", {
        sessionId: second.id,
      })) as { trends: { trend: string }[] };
      expect(after.trends).toHaveLength(1);
      expect(after.trends[0]?.trend).toBe("improving");
    } else {
      // A fortnight from today crosses into the next month, so the second
      // review is about a different month and starts empty. That is the same
      // rule seen from the other side, and asserting it keeps this test
      // meaningful on every day of the year rather than only most of them.
      expect(before.trends).toHaveLength(0);
    }
  });

  it("stamps the cycle on the decision, so moving the goal cannot rewrite it", async () => {
    // The reason `decisions.cycle_id` exists rather than being joined through
    // the goal. `goals.moveToCycle` is a real action, and a derived cycle
    // would make a decision taken in this cycle read as one taken in the next.
    await call("sessions.recordDecision", {
      sessionId,
      keyResultId,
      text: "Move two engineers off billing onto activation",
    });

    // A date inside the next quarter, which is what the action takes.
    const next = (await call("cycles.create", {
      on: new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10),
      cadence: "quarterly",
    })) as { id: string };
    await call("goals.moveToCycle", { id: goalId, cycleId: next.id });

    const stillHere = (await call("decisions.forCycle", { cycleId })) as {
      id: string;
    }[];
    const notThere = (await call("decisions.forCycle", {
      cycleId: next.id,
    })) as { id: string }[];
    expect(stillHere).toHaveLength(1);
    expect(notThere).toHaveLength(0);
  });
});

describe("decisions.forCycle", () => {
  it("lists every decision in the cycle", async () => {
    await call("sessions.recordDecision", {
      sessionId,
      keyResultId,
      text: "Move two engineers off billing onto activation",
    });
    await call("sessions.recordDecision", {
      sessionId,
      goalId,
      text: "Hold the objective as written",
    });

    const decisions = (await call("decisions.forCycle", { cycleId })) as {
      id: string;
    }[];
    expect(decisions).toHaveLength(2);
  });
});

describe("access", () => {
  it("refuses the record to a suspended member", async () => {
    await expect(
      call("sessions.monthlyRecord", { sessionId }, OUTSIDER),
    ).rejects.toThrow();
    expect(outsiderMemberId).toBeTruthy();
  });

  it("returns no decisions on a goal a suspended member cannot see", async () => {
    await call("sessions.recordDecision", {
      sessionId,
      keyResultId,
      text: "Move two engineers off billing onto activation",
    });

    // Not-found rather than a partial list: the access getter refuses the goal
    // and the decisions never get read at all, so an empty array never has to
    // be told apart from a refusal.
    await expect(
      call("decisions.forGoal", { goalId }, OUTSIDER),
    ).rejects.toThrow();
  });
});
