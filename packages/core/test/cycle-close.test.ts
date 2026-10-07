/**
 * Closing a cycle is one act that feeds the next one (METHOD.md §8.9,
 * completeness review M-05).
 *
 * §8.9: "At close, the product feeds the next cycle automatically." Until M-05
 * the archive and the feed-forward were two buttons, nothing ever set a cycle
 * to `closed`, and the lowest process-health statement landed as a Phase 2
 * issue although §8.9's table sends it to Phase 3 as a priority.
 *
 * What only rows can settle:
 * - closing writes the snapshot, marks the cycle closed and feeds the next
 *   cycle when it already exists
 * - a next cycle created after the close is fed at creation
 * - running any of it twice duplicates nothing, including two closes at once
 * - the process-health statement is a priority, not an issue
 * - phase 7 must be complete first, and the refusal says what is missing
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "close-facilitator";

let workspaceId: string;
let cycleId: string;
let cycleEndsOn: string;
let spaceId: string;
let memberId: string;
let sessionId: string;
let keyResultId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: FACILITATOR },
});

const call = async (name: string, input: unknown) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context() },
    name as never,
    input as never,
  );
};

interface Closed {
  cycleId: string;
  snapshots: number;
  resultValue: number | null;
  verdict: string | null;
  fedInto: {
    cycleId: string;
    name: string;
    priorScores: number;
    issues: number;
    processPriority: string | null;
    packNote: boolean;
  } | null;
}

const close = async () => (await call("cycles.close", { cycleId })) as Closed;

/** A day inside the quarter after the current one, which is how `cycles.create` asks for it. */
const dayAfter = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

const createNext = async () =>
  (await call("cycles.create", {
    on: dayAfter(cycleEndsOn, 15),
    cadence: "quarterly",
  })) as { id: string; name: string };

async function rows<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, params)).rows;
}

const issuesIn = (id: string) =>
  rows<{ text: string; impact: number; source: string }>(
    `select text, impact, source from cycle_issues
      where cycle_id = $1 and deleted_at is null order by text`,
    [id],
  );

const prioritiesIn = (id: string) =>
  rows<{ text: string }>(
    `select text from cycle_priorities
      where cycle_id = $1 and deleted_at is null order by position`,
    [id],
  );

const priorScoresIn = (id: string) =>
  rows<{ text: string; score: string | null }>(
    `select text, score from cycle_prior_scores
      where cycle_id = $1 and deleted_at is null order by position`,
    [id],
  );

const cycleRow = async (id: string) =>
  (
    await rows<{
      status: string;
      phase: number;
      previous_cycle_id: string | null;
    }>("select status, phase, previous_cycle_id from cycles where id = $1", [
      id,
    ])
  )[0];

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Facilitator', $2)`,
    [FACILITATOR, "close-facilitator@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FACILITATOR,
    name: "Facilitator",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
    endsOn: string;
  };
  cycleId = current.id;
  cycleEndsOn = current.endsOn;

  const goal = (await call("goals.create", {
    title: "Become the platform mid-market teams reach for first",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: memberId,
    reviewerId: memberId,
    weight: 1,
  })) as { id: string };
  const keyResult = (await call("goals.addKeyResult", {
    goalId: goal.id,
    title: "Raise weekly active teams from 120 to 300",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 120,
    targetValue: 300,
    unit: "teams",
    weight: 1,
  })) as { id: string };
  keyResultId = keyResult.id;

  const session = (await call("sessions.create", {
    spaceId,
    cycleId,
    kind: "quarterly",
    title: "Quarterly review",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: memberId,
  })) as { id: string };
  sessionId = session.id;
  await call("sessions.open", { id: sessionId });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/**
 * The review that completes phase 7: every key result scored and a retro
 * written, plus a carried learning and a survey for §8.9 to hand on.
 */
const holdTheReview = async () => {
  await call("sessions.scoreKeyResult", {
    sessionId,
    keyResultId,
    score: 0.4,
    reason: "Landed 210 of 300.",
  });
  await call("sessions.addRetroNote", {
    sessionId,
    columnKey: "didnt",
    text: "Nobody owned the integration dependency.",
    anonymous: false,
  });
  await call("sessions.captureLearning", {
    sessionId,
    text: "We learned that a dependency nobody owns is a dependency nobody clears.",
    carryForward: true,
  });
  await call("sessions.submitProcessHealth", {
    sessionId,
    // Statement three lowest at 2, so it is the one §8.5 names.
    scores: [5, 4, 2, 5, 4].map((score, index) => ({
      statementKey: index + 1,
      score,
    })),
  });
  await call("sessions.close", { id: sessionId });
  // The key result is flagged to carry, which §8.9 sends to Phase 2 as an
  // issue. The flag is written by the goal's own close; set directly here
  // because this file is about the cycle's close, not the goal's.
  const wb = await workerDb();
  await wb.admin.query(
    "update key_results set carry_forward = true where id = $1",
    [keyResultId],
  );
};

describe("closing a cycle", () => {
  it("refuses until phase 7 is complete, and says what is missing", async () => {
    await expect(close()).rejects.toThrow(/phase 7 is complete/i);
    await expect(close()).rejects.toThrow(/Not every key result is scored/);
    await expect(close()).rejects.toThrow(/retrospective is not written/);

    // Nothing was written by the refusal.
    expect((await cycleRow(cycleId))?.status).not.toBe("closed");
    expect(
      await rows("select id from performance_snapshots where cycle_id = $1", [
        cycleId,
      ]),
    ).toHaveLength(0);
  });

  it("writes the snapshot, sets the cycle closed and feeds the next cycle that exists", async () => {
    const next = await createNext();
    // Created before the close, so nothing was waiting for it yet.
    expect(await priorScoresIn(next.id)).toHaveLength(0);

    await holdTheReview();
    const closed = await close();

    // The archive: the workspace and the champion, at the one score.
    expect(closed.resultValue).toBe(0.4);
    expect(closed.snapshots).toBe(3);
    const snapshots = await rows<{ owner_kind: string }>(
      "select owner_kind from performance_snapshots where cycle_id = $1 and deleted_at is null",
      [cycleId],
    );
    expect(snapshots.map((row) => row.owner_kind).sort()).toEqual([
      "member",
      "space",
      "workspace",
    ]);

    const row = await cycleRow(cycleId);
    expect(row?.status).toBe("closed");
    expect(row?.phase).toBe(7);

    // The feed-forward, in the same act.
    expect(closed.fedInto?.cycleId).toBe(next.id);
    expect(closed.fedInto?.name).toBe(next.name);
    expect((await cycleRow(next.id))?.previous_cycle_id).toBe(cycleId);

    const scores = await priorScoresIn(next.id);
    expect(scores.map((score) => score.text)).toEqual([
      "Raise weekly active teams from 120 to 300",
    ]);
    expect(Number(scores[0]?.score)).toBe(0.4);

    // Carried work stays a Phase 2 issue at the carry-forward impact: the key
    // result and the learning both.
    const issues = await issuesIn(next.id);
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.source === "carry_forward")).toBe(
      true,
    );
    expect(issues.every((issue) => issue.impact === 4)).toBe(true);
    expect(closed.fedInto?.packNote).toBe(true);
  });

  it("closes past an objective stopped mid-cycle, whose key results are not scored (P9-T22c-c-b)", async () => {
    const stopped = (await call("goals.create", {
      title: "Expansion comes from accounts that reached value",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
    })) as { id: string };
    await call("goals.addKeyResult", {
      goalId: stopped.id,
      title: "Raise expansion seats added from 138 to 170 a month",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 138,
      targetValue: 170,
      weight: 1,
    });
    await call("goals.stop", {
      id: stopped.id,
      reason: "Capacity moves to the competitive response",
    });

    await holdTheReview();
    await close();
    expect((await cycleRow(cycleId))?.status).toBe("closed");
  });

  it("makes the lowest process-health statement Phase 3's improvement action, not an issue", async () => {
    const next = await createNext();
    await holdTheReview();
    const closed = await close();

    // Statement three scored 2, the lowest of the five.
    expect(closed.fedInto?.processPriority).toContain("measured outcomes");
    const priorities = await prioritiesIn(next.id);
    expect(priorities).toHaveLength(1);
    expect(priorities[0]?.text).toContain("measured outcomes");

    // §8.9's table: "Phase 3, an improvement action". Not a Phase 2 issue.
    const issues = await issuesIn(next.id);
    expect(issues.some((issue) => issue.source === "process_health")).toBe(
      false,
    );
    expect(
      issues.some((issue) => issue.text.includes("measured outcomes")),
    ).toBe(false);
  });

  it("feeds a next cycle created after the close, at creation", async () => {
    await holdTheReview();
    const closed = await close();
    // §8.10 holds the review before the next cycle is drafted, so usually
    // there is nowhere to send the inheritance at close.
    expect(closed.fedInto).toBeNull();

    const next = await createNext();

    expect((await cycleRow(next.id))?.previous_cycle_id).toBe(cycleId);
    expect(await priorScoresIn(next.id)).toHaveLength(1);
    expect(await issuesIn(next.id)).toHaveLength(2);
    const priorities = await prioritiesIn(next.id);
    expect(priorities.map((priority) => priority.text)).toEqual([
      expect.stringContaining("measured outcomes"),
    ]);

    // Phase 7 of the closed cycle names where its inheritance went.
    const workflow = (await call("workflow.read", { cycleId })) as {
      closure: {
        verdict: string | null;
        resultValue: number | null;
        nextCycle: { id: string; name: string } | null;
        priorScores: number;
        carriedIssues: number;
        processPriority: string | null;
        packNote: boolean;
      } | null;
    };
    expect(workflow.closure).toMatchObject({
      resultValue: 0.4,
      nextCycle: { id: next.id, name: next.name },
      priorScores: 1,
      carriedIssues: 2,
      packNote: true,
    });
    expect(workflow.closure?.processPriority).toContain("measured outcomes");
  });

  it("carries a kept objective into the next cycle as a draft, and phase 7 says so (§8.9, P9-T20e-b)", async () => {
    const [goal] = await rows<{ id: string }>(
      "select id from goals where cycle_id = $1 and deleted_at is null",
      [cycleId],
    );
    await call("sessions.decideObjective", {
      sessionId,
      goalId: goal?.id,
      decision: "keep",
      why: "Still the bet for the next quarter.",
    });
    await holdTheReview();
    await close();
    // Created after the close, the order §8.10 asks for, so the draft lands
    // when the next cycle does.
    const next = await createNext();

    const drafts = await rows<{ title: string }>(
      `select title from goals
        where cycle_id = $1 and carried_from_goal_id = $2 and deleted_at is null`,
      [next.id, goal?.id],
    );
    expect(drafts.map((row) => row.title)).toEqual([
      "Become the platform mid-market teams reach for first",
    ]);

    const workflow = (await call("workflow.read", { cycleId })) as {
      closure: { carriedDrafts: number; notCarried: string[] } | null;
    };
    expect(workflow.closure).toMatchObject({
      carriedDrafts: 1,
      notCarried: [],
    });
  });

  it("reads no closure for a cycle that is still open", async () => {
    const workflow = (await call("workflow.read", { cycleId })) as {
      closure: unknown;
    };
    expect(workflow.closure).toBeNull();
  });
});

describe("running it twice", () => {
  it("refuses a second close and duplicates nothing", async () => {
    const next = await createNext();
    await holdTheReview();
    await close();

    const before = {
      scores: await priorScoresIn(next.id),
      issues: await issuesIn(next.id),
      priorities: await prioritiesIn(next.id),
    };
    await expect(close()).rejects.toThrow(/already closed/i);

    // The manual re-run the API still offers adds nothing that is there.
    const again = (await call("cycles.feedForward", {
      fromCycleId: cycleId,
      toCycleId: next.id,
    })) as { priorScores: number; issues: number; processPriority: string };
    expect(again.priorScores).toBe(0);
    expect(again.issues).toBe(0);
    expect(again.processPriority).toContain("measured outcomes");

    expect(await priorScoresIn(next.id)).toEqual(before.scores);
    expect(await issuesIn(next.id)).toEqual(before.issues);
    expect(await prioritiesIn(next.id)).toEqual(before.priorities);
  });

  it("lets one of two closes arriving together through, and feeds once", async () => {
    const next = await createNext();
    await holdTheReview();

    const outcomes = await Promise.allSettled([close(), close()]);

    expect(outcomes.filter((one) => one.status === "fulfilled")).toHaveLength(
      1,
    );
    const refused = outcomes.find((one) => one.status === "rejected");
    expect(String((refused as PromiseRejectedResult).reason)).toMatch(
      /already closed/i,
    );
    expect(await priorScoresIn(next.id)).toHaveLength(1);
    expect(await issuesIn(next.id)).toHaveLength(2);
    expect(await prioritiesIn(next.id)).toHaveLength(1);
  });

  it("feeds the next cycle when it is created while the close is running", async () => {
    await holdTheReview();

    // Whichever commits first, the other has to see it: the close finds the
    // new cycle, or the creation finds the closed one. Missing each other
    // would leave the inheritance nowhere. The window is narrow and this
    // usually passes without the row lock too, so it guards the outcome
    // rather than proving the lock; the test above is the one that fails
    // every time the lock is taken out.
    const [, created] = await Promise.all([close(), createNext()]);

    expect((await cycleRow(created.id))?.previous_cycle_id).toBe(cycleId);
    expect(await priorScoresIn(created.id)).toHaveLength(1);
    expect(await issuesIn(created.id)).toHaveLength(2);
    expect(await prioritiesIn(created.id)).toHaveLength(1);
  });

  it("feeds a cycle created after the close once, however it is re-run", async () => {
    await holdTheReview();
    await close();
    const next = await createNext();

    await call("cycles.feedForward", {
      fromCycleId: cycleId,
      toCycleId: next.id,
    });

    expect(await priorScoresIn(next.id)).toHaveLength(1);
    expect(await issuesIn(next.id)).toHaveLength(2);
    expect(await prioritiesIn(next.id)).toHaveLength(1);
  });

  it("does not hand one close to a second successor or reach past an open cycle", async () => {
    await holdTheReview();
    await close();
    const next = await createNext();
    // The quarter after next: its predecessor is `next`, which is open, so
    // nothing reaches back two quarters to the closed one.
    const afterNext = (await call("cycles.create", {
      on: dayAfter(cycleEndsOn, 120),
      cadence: "quarterly",
    })) as { id: string };

    expect((await cycleRow(next.id))?.previous_cycle_id).toBe(cycleId);
    expect((await cycleRow(afterNext.id))?.previous_cycle_id).toBeNull();
    expect(await priorScoresIn(afterNext.id)).toHaveLength(0);
    expect(await prioritiesIn(afterNext.id)).toHaveLength(0);
  });

  it("never feeds across modes: a closed quarter does not feed a year", async () => {
    await holdTheReview();
    await close();
    const year = (await call("cycles.create", {
      on: dayAfter(cycleEndsOn, 200),
      cadence: "annual",
    })) as { id: string };

    expect((await cycleRow(year.id))?.previous_cycle_id).toBeNull();
    expect(await priorScoresIn(year.id)).toHaveLength(0);
  });
});

describe("a closed cycle's record", () => {
  it("refuses a new goal, a session, an edit and a second snapshot", async () => {
    await holdTheReview();
    await close();

    await expect(
      call("goals.create", {
        title: "One more thing",
        cycleId,
        spaceId,
        level: "team",
        ownerKind: "space",
        championId: memberId,
        reviewerId: memberId,
        weight: 1,
      }),
    ).rejects.toThrow(/closed/i);
    await expect(
      call("sessions.create", {
        spaceId,
        cycleId,
        kind: "monthly",
        title: "A late review",
        scheduledFor: new Date(Date.now() + 7_200_000).toISOString(),
        facilitatorId: memberId,
      }),
    ).rejects.toThrow(/closed/i);
    await expect(
      call("cycles.update", { id: cycleId, phase: 3 }),
    ).rejects.toThrow(/closed/i);
    await expect(call("cycles.snapshot", { cycleId })).rejects.toThrow(
      /closed/i,
    );
  });

  it("refuses to be fed into", async () => {
    const next = await createNext();
    await holdTheReview();
    await close();
    // The closed cycle as a target: feeding it would rewrite its phases.
    await expect(
      call("cycles.feedForward", { fromCycleId: next.id, toCycleId: cycleId }),
    ).rejects.toThrow(/closed/i);
  });
});

describe("a closed cycle keeps the rules it was graded under (§12, P9-T14b)", () => {
  /** The review again, graded 0.65: on target under Google's colours. */
  const holdTheReviewAt = async (score: number) => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId,
      score,
      reason: "Landed most of the way.",
    });
    await call("sessions.addRetroNote", {
      sessionId,
      columnKey: "didnt",
      text: "Nobody owned the integration dependency.",
      anonymous: false,
    });
    await call("sessions.submitProcessHealth", {
      sessionId,
      scores: [5, 4, 2, 5, 4].map((value, index) => ({
        statementKey: index + 1,
        score: value,
      })),
    });
    await call("sessions.close", { id: sessionId });
  };

  const bandAtTheReview = async () => {
    const status = (await call("sessions.scoringStatus", { sessionId })) as {
      objectives: { keyResults: { band: { key: string } | null }[] }[];
    };
    return status.objectives[0]?.keyResults[0]?.band?.key;
  };

  it("acceptance A7: bands moved after the close leave its verdicts as they were, and the open cycle reads the new ones", async () => {
    await holdTheReviewAt(0.65);
    await close();

    const [snapshot] = await rows<{
      practice_snapshot: {
        thresholds: Record<string, unknown>;
        practice: Record<string, unknown>;
      } | null;
    }>("select practice_snapshot from cycles where id = $1", [cycleId]);
    expect(snapshot?.practice_snapshot?.practice["scoring.colours"]).toBe(
      "google",
    );
    expect(
      snapshot?.practice_snapshot?.thresholds["scoring.scoreBands"],
    ).toEqual({ achieved: 1, strong: 0.6, partial: 0.3 });
    expect(await bandAtTheReview()).toBe("strong");

    // An admin changes the bands to Doerr's colours.
    await call("practice.update", {
      overrides: { "scoring.colours": "doerr" },
    });
    expect(await bandAtTheReview()).toBe("strong");
    expect(
      ((await call("cycles.rules", { cycleId })) as { source: string }).source,
    ).toBe("snapshot");

    const next = (await createNext()) as { id: string };
    const open = (await call("cycles.rules", { cycleId: next.id })) as {
      source: string;
      practice: Record<string, unknown>;
    };
    expect(open.source).toBe("live");
    expect(open.practice["scoring.colours"]).toBe("doerr");
  });

  it("reads today's canon for a cycle closed before snapshots existed", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update cycles set status = 'closed', practice_snapshot = null where id = $1",
      [cycleId],
    );
    await call("practice.update", {
      overrides: { "scoring.colours": "doerr" },
    });
    const rules = (await call("cycles.rules", { cycleId })) as {
      source: string;
      practice: Record<string, unknown>;
    };
    expect(rules.source).toBe("canon");
    expect(rules.practice["scoring.colours"]).toBe("google");
  });
});

describe("the scorecard by cycle (P9-T14c)", () => {
  /** A review in `cycle` that completes its phase 7, graded at `score`. */
  const reviewIn = async (
    cycle: string,
    keyResult: string,
    session: string,
    score: number,
  ) => {
    await call("sessions.scoreKeyResult", {
      sessionId: session,
      keyResultId: keyResult,
      score,
      reason: "Landed most of the way.",
    });
    await call("sessions.addRetroNote", {
      sessionId: session,
      columnKey: "didnt",
      text: "Nobody owned the integration dependency.",
      anonymous: false,
    });
    await call("sessions.submitProcessHealth", {
      sessionId: session,
      scores: [5, 4, 2, 5, 4].map((value, index) => ({
        statementKey: index + 1,
        score: value,
      })),
    });
    await call("sessions.close", { id: session });
    await call("cycles.close", { cycleId: cycle });
  };

  interface Row {
    cycleId: string;
    bands: { achieved: number; strong: number; partial: number };
    resultBand: string | null;
    moved: {
      adjusted: { score: number; computed: number; reason: string }[];
      eased: {
        original: number;
        target: number | null;
        reason: string | null;
      }[];
      addedMidCycle: number;
      kindChanges: { from: string; to: string; reason: string | null }[];
    };
  }

  it("acceptance: two cycles closed under different bands each read their own, and show what moved in them", async () => {
    // The first cycle, under Google's colours: its target eased, its
    // objective made committed, and its grade above what its progress
    // computes.
    const [goal] = await rows<{ id: string }>(
      "select goal_id as id from key_results where id = $1",
      [keyResultId],
    );
    await call("goals.changeTarget", {
      id: keyResultId,
      targetValue: 250,
      reason: "The integration partner left the market",
    });
    await call("goals.setKind", {
      id: goal?.id,
      kind: "committed",
      reason: "The board asked for it as a promise",
    });
    await reviewIn(cycleId, keyResultId, sessionId, 0.65);

    // The second, under Doerr's.
    await call("practice.update", {
      overrides: { "scoring.colours": "doerr" },
    });
    const next = await createNext();
    const nextGoal = (await call("goals.create", {
      title: "Make the first week the reason teams renew",
      cycleId: next.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
    })) as { id: string };
    const nextKeyResult = (await call("goals.addKeyResult", {
      goalId: nextGoal.id,
      title: "Renewal after the first week from 61% to 70%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 61,
      targetValue: 70,
      weight: 1,
    })) as { id: string };
    const nextSession = (await call("sessions.create", {
      spaceId,
      cycleId: next.id,
      kind: "quarterly",
      title: "Next quarterly review",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: memberId,
    })) as { id: string };
    await call("sessions.open", { id: nextSession.id });
    await reviewIn(next.id, nextKeyResult.id, nextSession.id, 0.65);

    const scorecard = (await call("cycles.scorecard", {})) as { rows: Row[] };
    const first = scorecard.rows.find((row) => row.cycleId === cycleId);
    const second = scorecard.rows.find((row) => row.cycleId === next.id);

    // Each colours by its own bands: 0.65 is on target under 0.6, partial
    // under 0.7.
    expect(first?.bands).toEqual({ achieved: 1, strong: 0.6, partial: 0.3 });
    expect(first?.resultBand).toBe("strong");
    expect(second?.bands).toEqual({ achieved: 1, strong: 0.7, partial: 0.4 });
    expect(second?.resultBand).toBe("partial");

    // And what moved in the first, behind its number.
    expect(first?.moved.adjusted).toEqual([
      expect.objectContaining({
        score: 0.65,
        computed: 0,
        reason: "Landed most of the way.",
      }),
    ]);
    expect(first?.moved.eased).toEqual([
      expect.objectContaining({
        original: 300,
        target: 250,
        reason: "The integration partner left the market",
      }),
    ]);
    expect(first?.moved.kindChanges).toEqual([
      expect.objectContaining({
        from: "aspirational",
        to: "committed",
        reason: "The board asked for it as a promise",
      }),
    ]);
    expect(second?.moved.eased).toEqual([]);
  });

  it("shows the target the plan published with as the original, not an edit made while drafting (P9-T22c-c-b)", async () => {
    // Drafting: 300 becomes 320 before anybody publishes.
    await call("goals.changeTarget", { id: keyResultId, targetValue: 320 });
    // Published, set directly as the mid-cycle tests do, because publishing
    // through the gates is not what is under test.
    const wb = await workerDb();
    await wb.admin.query(
      "update cycles set published_at = now() where id = $1",
      [cycleId],
    );
    await call("goals.changeTarget", {
      id: keyResultId,
      targetValue: 250,
      reason: "The integration partner left the market",
    });
    await reviewIn(cycleId, keyResultId, sessionId, 0.65);

    const scorecard = (await call("cycles.scorecard", {})) as { rows: Row[] };
    const row = scorecard.rows.find((one) => one.cycleId === cycleId);
    expect(row?.moved.eased).toEqual([
      expect.objectContaining({ original: 320, target: 250 }),
    ]);
  });
});
