/**
 * Scoring the key results and revealing them (METHOD.md §8.3,
 * p4-t00-session-design.md §4.3, P4-T10b-a and P4-T10b-b).
 *
 * P4-T10b-a's test plan:
 * - a score is refused outside 0.0 to 1.0 and refused without a reason
 * - scores written here land on the key results on close, and not before
 *
 * P4-T10b-b's test plan:
 * - the reveal is deterministic
 * - no caller can read an objective's score before it is revealed
 *
 * The acceptance criterion: when every key result of an objective has a score
 * and a reason, the stage may be completed, and the scores are on the key
 * results once the session closes.
 *
 * **Why the score does not go straight onto the key result.** §8.3 hides the
 * objective score until the room reveals it, and a score on `key_results.score`
 * is visible to anybody reading the goal page immediately. It also has to be
 * revisable while the room talks itself from 0.6 to 0.4 and back. Neither is a
 * fact about the key result until the review is over, which is what the
 * write-back on close is for.
 */
import { objectiveScore } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "scoring-facilitator";
const MEMBER = "scoring-member";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let memberMemberId: string;
let sessionId: string;
let goalId: string;
let heavyKeyResultId: string;
let lightKeyResultId: string;

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

const scoring = async (userId = FACILITATOR) =>
  (await call("sessions.scoringStatus", { sessionId }, userId)) as {
    objectives: {
      goalId: string;
      goalTitle: string;
      score: number | null;
      revealed: boolean;
      scored: number;
      total: number;
      keyResults: {
        keyResultId: string;
        title: string;
        weight: number;
        baseline: number | null;
        target: number | null;
        current: number | null;
        score: number | null;
        reason: string | null;
      }[];
    }[];
    cycleScore: number | null;
    verdict: string | null;
    complete: boolean;
  };

const storedScore = async (keyResultId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ score: string | null }>(
    "select score from key_results where id = $1",
    [keyResultId],
  );
  return rows[0]?.score ?? null;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)`,
    [
      FACILITATOR,
      "Facilitator",
      "scoring-facilitator@example.com",
      MEMBER,
      "Member",
      "scoring-member@example.com",
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

  // Uneven weights, because the whole point of the objective score is that it
  // follows §3.2's weighting rather than counting heads.
  const heavy = (await call("goals.addKeyResult", {
    goalId,
    title: "Raise weekly active teams from 120 to 300 by 31 March",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 120,
    targetValue: 300,
    unit: "teams",
    weight: 3,
  })) as { id: string };
  heavyKeyResultId = heavy.id;

  const light = (await call("goals.addKeyResult", {
    goalId,
    title: "Cut median onboarding from 9 days to 2 days",
    direction: "reduce",
    indicatorType: "lagging",
    baselineValue: 9,
    targetValue: 2,
    unit: "days",
    weight: 1,
  })) as { id: string };
  lightKeyResultId = light.id;

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

describe("sessions.scoreKeyResult", () => {
  it("records a score with its reason", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.6,
      reason: "Landed 210 of 300. Activation held, the funnel did not.",
    });

    const status = await scoring();
    const objective = status.objectives[0];
    const heavy = objective?.keyResults.find(
      (entry) => entry.keyResultId === heavyKeyResultId,
    );
    expect(heavy?.score).toBe(0.6);
    expect(heavy?.reason).toContain("Landed 210");
    expect(objective?.scored).toBe(1);
    expect(objective?.total).toBe(2);
  });

  it("puts the evidence §8.3 asks for beside the slider", async () => {
    // Baseline, target and actual on screen. Read from the key result rather
    // than typed into the review, so a room grades against what was written.
    const status = await scoring();
    const heavy = status.objectives[0]?.keyResults.find(
      (entry) => entry.keyResultId === heavyKeyResultId,
    );
    expect(heavy?.baseline).toBe(120);
    expect(heavy?.target).toBe(300);
    expect(heavy?.current).not.toBeUndefined();
    expect(heavy?.weight).toBe(3);
  });

  it("refuses a score outside nought to one", async () => {
    for (const score of [-0.1, 1.1]) {
      await expect(
        call("sessions.scoreKeyResult", {
          sessionId,
          keyResultId: heavyKeyResultId,
          score,
          reason: "Out of range.",
        }),
      ).rejects.toThrow();
    }
  });

  it("refuses a score with no reason", async () => {
    // §8.3 asks for a one-line reason. "Facts, not feelings" cannot be
    // enforced, but a score nobody explained can be refused.
    await expect(
      call("sessions.scoreKeyResult", {
        sessionId,
        keyResultId: heavyKeyResultId,
        score: 0.6,
        reason: "   ",
      }),
    ).rejects.toThrow();
  });

  it("regrades rather than storing two answers", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.6,
      reason: "First read of it.",
    });
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.4,
      reason: "Talked it down: the target moved mid-cycle.",
    });

    const status = await scoring();
    const objective = status.objectives[0];
    expect(objective?.scored).toBe(1);
    expect(
      objective?.keyResults.find(
        (entry) => entry.keyResultId === heavyKeyResultId,
      )?.score,
    ).toBe(0.4);
  });

  it("is refused on a session that does not score", async () => {
    const weekly = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };

    await expect(
      call("sessions.scoreKeyResult", {
        sessionId: weekly.id,
        keyResultId: heavyKeyResultId,
        score: 0.6,
        reason: "Wrong ritual.",
      }),
    ).rejects.toThrow(/quarterly/i);
  });
});

describe("the objective score follows §3.2's weighting", () => {
  it("weights by the key result's weight, not by count", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.2,
      reason: "Missed badly.",
    });
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: lightKeyResultId,
      score: 0.8,
      reason: "Landed.",
    });

    // Revealed first, because P4-T10b-b withholds the number until the room
    // reveals it. What is under test here is the weighting, not the hiding.
    await call("sessions.revealObjectiveScore", { sessionId, goalId });

    const status = await scoring();
    // Weights 3 and 1, so (0.2*3 + 0.8*1) / 4 = 0.35. A plain mean is 0.5, and
    // that difference is the whole reason this is not a mean.
    expect(status.objectives[0]?.score).toBeCloseTo(0.35, 10);
    expect(status.objectives[0]?.score).toBe(
      objectiveScore([
        { score: 0.2, weight: 3 },
        { score: 0.8, weight: 1 },
      ]),
    );
  });

  it("leaves the cycle score a plain average, as §8.6 words it", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.2,
      reason: "Missed badly.",
    });
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: lightKeyResultId,
      score: 0.8,
      reason: "Landed.",
    });

    await call("sessions.revealObjectiveScore", { sessionId, goalId });

    const status = await scoring();
    // Two different questions about two different sets: the objective is
    // weighted at 0.35, the cycle is the plain average of the key results at
    // 0.5. A single formula for both would get one of them wrong.
    expect(status.cycleScore).toBeCloseTo(0.5, 10);
    expect(status.verdict).toBe("partial");
  });

  it("has no objective score before anything is graded", async () => {
    const status = await scoring();
    expect(status.objectives[0]?.score).toBeNull();
    expect(status.cycleScore).toBeNull();
    expect(status.verdict).toBeNull();
    expect(status.complete).toBe(false);
  });
});

describe("the acceptance criterion", () => {
  it("is complete only when every key result has a score", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.6,
      reason: "Partly.",
    });
    expect((await scoring()).complete).toBe(false);

    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: lightKeyResultId,
      score: 0.9,
      reason: "Landed early.",
    });
    expect((await scoring()).complete).toBe(true);
  });

  it("lands the scores on the key results when the session closes, and not before", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.6,
      reason: "Landed 210 of 300.",
    });
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: lightKeyResultId,
      score: 0.9,
      reason: "Two days flat.",
    });

    // Not before. §8.3 hides the objective score until the room reveals it, and
    // a score on the key result is visible on the goal page immediately.
    expect(await storedScore(heavyKeyResultId)).toBeNull();
    expect(await storedScore(lightKeyResultId)).toBeNull();

    await call("sessions.close", { id: sessionId });

    expect(Number(await storedScore(heavyKeyResultId))).toBeCloseTo(0.6, 10);
    expect(Number(await storedScore(lightKeyResultId))).toBeCloseTo(0.9, 10);
  });

  it("writes back only what was scored, leaving the rest alone", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.6,
      reason: "Only this one.",
    });
    await call("sessions.close", { id: sessionId });

    expect(Number(await storedScore(heavyKeyResultId))).toBeCloseTo(0.6, 10);
    // An ungraded key result keeps whatever it had. Writing zero would be the
    // review claiming a result it never discussed.
    expect(await storedScore(lightKeyResultId)).toBeNull();
  });
});

describe("access", () => {
  it("lets any member of the room grade, because the room grades together", async () => {
    // §8.3 is the team scoring, not the facilitator scoring at them. The floor
    // is `edit`, which every active member holds (P3-T16), and that is the
    // intent here rather than an accident.
    await call(
      "sessions.scoreKeyResult",
      {
        sessionId,
        keyResultId: heavyKeyResultId,
        score: 0.5,
        reason: "The room talked it to a half.",
      },
      MEMBER,
    );
    expect((await scoring(MEMBER)).objectives[0]?.scored).toBe(1);
    expect(memberMemberId).toBeTruthy();
  });

  it("refuses a suspended member", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberMemberId],
    );

    await expect(
      call(
        "sessions.scoreKeyResult",
        {
          sessionId,
          keyResultId: heavyKeyResultId,
          score: 0.5,
          reason: "No longer here.",
        },
        MEMBER,
      ),
    ).rejects.toThrow();
    await expect(scoring(MEMBER)).rejects.toThrow();
  });
});

describe("the reveal (P4-T10b-b)", () => {
  /** Grades both key results of the seeded objective at 0.2 and 0.8. */
  const gradeBoth = async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.2,
      reason: "Missed badly.",
    });
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: lightKeyResultId,
      score: 0.8,
      reason: "Landed.",
    });
  };

  it("withholds the objective score from every caller until it is revealed", async () => {
    await gradeBoth();

    // The test-plan line, at the action rather than at the screen. P4-T10b-a
    // kept the number off the grading screen; the read still returned it, so a
    // second surface or a REST caller saw what the room had not.
    for (const viewer of [FACILITATOR, MEMBER]) {
      const status = await scoring(viewer);
      const objective = status.objectives[0];
      expect(objective?.revealed).toBe(false);
      expect(objective?.score).toBeNull();
      // The grades themselves stay visible: the room graded them together and
      // §8.3 hides the objective's roll-up, not the key results.
      expect(objective?.keyResults.every((entry) => entry.score !== null)).toBe(
        true,
      );
    }
  });

  it("gives every participant the same number once it is revealed", async () => {
    await gradeBoth();
    await call("sessions.revealObjectiveScore", { sessionId, goalId });

    for (const viewer of [FACILITATOR, MEMBER]) {
      const status = await scoring(viewer);
      expect(status.objectives[0]?.revealed).toBe(true);
      expect(status.objectives[0]?.score).toBeCloseTo(0.35, 10);
    }
  });

  it("is one write, so a second reveal changes nothing", async () => {
    await gradeBoth();
    const first = (await call("sessions.revealObjectiveScore", {
      sessionId,
      goalId,
    })) as { revealed: number };
    const second = (await call("sessions.revealObjectiveScore", {
      sessionId,
      goalId,
    })) as { revealed: number };

    expect(first.revealed).toBe(2);
    // Deterministic: the second call finds nothing left to reveal rather than
    // re-stamping the rows with a later time.
    expect(second.revealed).toBe(0);
    expect((await scoring()).objectives[0]?.score).toBeCloseTo(0.35, 10);
  });

  it("counts only revealed objectives in the cycle score", async () => {
    // Two objectives, so the pooled average is not simply the first
    // objective's own score. Counting every grade instead would, on a
    // single-objective review, publish the hidden number under another label.
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
    const secondKeyResult = (await call("goals.addKeyResult", {
      goalId: second.id,
      title: "Take first-week completion from 40 to 75 per cent",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 40,
      targetValue: 75,
      unit: "per cent",
      weight: 1,
    })) as { id: string };

    await gradeBoth();
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: secondKeyResult.id,
      score: 1,
      reason: "Finished at 78.",
    });

    // Nothing revealed: nothing to average.
    expect((await scoring()).cycleScore).toBeNull();
    expect((await scoring()).verdict).toBeNull();

    await call("sessions.revealObjectiveScore", { sessionId, goalId });
    // §8.6's plain average over the revealed key results: (0.2 + 0.8) / 2.
    expect((await scoring()).cycleScore).toBeCloseTo(0.5, 10);

    await call("sessions.revealObjectiveScore", {
      sessionId,
      goalId: second.id,
    });
    // (0.2 + 0.8 + 1.0) / 3. Still a plain average over key results, so the
    // one-key-result objective does not weigh as much as the two-key-result
    // one.
    expect((await scoring()).cycleScore).toBeCloseTo(2 / 3, 10);
  });

  it("keeps a regrade after the reveal visible, because the room may still change its mind", async () => {
    await gradeBoth();
    await call("sessions.revealObjectiveScore", { sessionId, goalId });
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.6,
      reason: "Talked back up: the target moved mid-cycle.",
    });

    const status = await scoring();
    expect(status.objectives[0]?.revealed).toBe(true);
    // (0.6*3 + 0.8*1) / 4 = 0.65. A revealed objective is not frozen: §8.3's
    // reveal is about who sees the number first, not about closing the debate.
    expect(status.objectives[0]?.score).toBeCloseTo(0.65, 10);
  });

  it("refuses a reveal from anybody but the facilitator", async () => {
    await gradeBoth();

    // §8.3 has the room grading and the facilitator revealing. The
    // write-access floor is edit for every active member (P3-T16), so edit
    // alone would let any participant reveal, which is the same reasoning
    // §8.1's add-a-minute control needed.
    await expect(
      call("sessions.revealObjectiveScore", { sessionId, goalId }, MEMBER),
    ).rejects.toThrow(/facilitator/i);
    expect((await scoring(MEMBER)).objectives[0]?.score).toBeNull();
  });

  it("refuses revealing an objective nobody graded", async () => {
    // There is no number to reveal, and an empty reveal would put the
    // objective into its revealed state with nothing behind it.
    await expect(
      call("sessions.revealObjectiveScore", { sessionId, goalId }),
    ).rejects.toThrow(/graded/i);
    expect((await scoring()).objectives[0]?.revealed).toBe(false);
  });

  it("reveals a half-graded objective, because §8.3 leaves the ungraded out", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: heavyKeyResultId,
      score: 0.2,
      reason: "Only this one so far.",
    });
    await call("sessions.revealObjectiveScore", { sessionId, goalId });

    const status = await scoring();
    // §8.3: "An unscored key result is left out rather than counted as zero, so
    // a half-graded objective does not read as a failing one." Weighted over
    // the graded rows alone, that is 0.2 rather than 0.15.
    expect(status.objectives[0]?.score).toBeCloseTo(0.2, 10);
    expect(status.objectives[0]?.revealed).toBe(true);
  });

  it("is refused on a session that does not score", async () => {
    const weekly = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };

    await expect(
      call("sessions.revealObjectiveScore", {
        sessionId: weekly.id,
        goalId,
      }),
    ).rejects.toThrow(/quarterly/i);
  });

  it("refuses an objective this review never graded", async () => {
    // The reveal names a goal, and an ungraded goal id would set revealed_at
    // on nothing while reporting success.
    const other = (await call("goals.create", {
      title: "Something the review does not cover at all",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: facilitatorMemberId,
      reviewerId: facilitatorMemberId,
      weight: 1,
    })) as { id: string };

    await expect(
      call("sessions.revealObjectiveScore", { sessionId, goalId: other.id }),
    ).rejects.toThrow(/graded/i);
  });
});
