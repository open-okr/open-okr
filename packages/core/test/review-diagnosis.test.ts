/**
 * Root causes and the process-health survey (METHOD.md §8.4 and §8.5,
 * p4-t00-session-design.md §4.8, P4-T11b).
 *
 * The task's test plan:
 * - a process-health response cannot be attributed to a member
 * - it cannot be submitted twice
 * - every key result below the threshold appears in the root-cause list
 *
 * The acceptance criterion: given a survey with four responses, when the
 * averages render, no response can be traced to a member and the count reads
 * four.
 *
 * **What anonymity means here, precisely.** No read returns an attribution and
 * no column carries one: `process_health_responses` has a salted hash where a
 * member id would go. That is what the product guarantees, and these tests
 * assert it. It is not anonymity against somebody holding both the database and
 * the member list, because a room is small enough to enumerate, and no scheme
 * that lets the same application recount a member's response can be.
 */
import { resolveThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "diagnosis-facilitator";
const SECOND = "diagnosis-second";
const THIRD = "diagnosis-third";
const FOURTH = "diagnosis-fourth";
const ROOM = [FACILITATOR, SECOND, THIRD, FOURTH];

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let sessionId: string;
let goalId: string;
let missedKeyResultId: string;
let landedKeyResultId: string;

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

const causes = async (userId = FACILITATOR) =>
  (await call("sessions.rootCauses", { sessionId }, userId)) as {
    threshold: number;
    keyResults: {
      keyResultId: string;
      title: string;
      goalTitle: string;
      score: number;
      causeKey: number | null;
      causeLabel: string | null;
      detail: string | null;
    }[];
    named: number;
    complete: boolean;
  };

const health = async (userId = FACILITATOR) =>
  (await call("sessions.processHealth", { sessionId }, userId)) as {
    statements: {
      statementKey: number;
      statement: string;
      average: number | null;
      mine: number | null;
    }[];
    responses: number;
    rhythmScore: number | null;
    lowest: { statementKey: number; statement: string } | null;
    submitted: boolean;
  };

const submit = async (scores: number[], userId = FACILITATOR) =>
  call(
    "sessions.submitProcessHealth",
    {
      sessionId,
      scores: scores.map((score, index) => ({
        statementKey: index + 1,
        score,
      })),
    },
    userId,
  );

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, 'Facilitator', $2), ($3, 'Second', $4),
            ($5, 'Third', $6), ($7, 'Fourth', $8)`,
    [
      FACILITATOR,
      "diagnosis-facilitator@example.com",
      SECOND,
      "diagnosis-second@example.com",
      THIRD,
      "diagnosis-third@example.com",
      FOURTH,
      "diagnosis-fourth@example.com",
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

  for (const [userId, name] of [
    [SECOND, "Second"],
    [THIRD, "Third"],
    [FOURTH, "Fourth"],
  ] as const) {
    const row = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, $3, 'active') returning id`,
      [workspaceId, userId, name],
    );
    await call("spaces.addMember", {
      spaceId,
      memberId: row.rows[0]?.id as string,
      role: "member",
    });
  }

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

  const missed = (await call("goals.addKeyResult", {
    goalId,
    title: "Raise weekly active teams from 120 to 300 by 31 March",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 120,
    targetValue: 300,
    unit: "teams",
    weight: 1,
  })) as { id: string };
  missedKeyResultId = missed.id;

  const landed = (await call("goals.addKeyResult", {
    goalId,
    title: "Cut median onboarding from 9 days to 2 days",
    direction: "reduce",
    indicatorType: "lagging",
    baselineValue: 9,
    targetValue: 2,
    unit: "days",
    weight: 1,
  })) as { id: string };
  landedKeyResultId = landed.id;

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

describe("the root-cause list", () => {
  it("is empty until the room has graded anything", async () => {
    // Nothing scored is not the same as nothing missed. §8.4 asks about key
    // results that came in under the threshold, and none have a score yet.
    const status = await causes();
    expect(status.keyResults).toHaveLength(0);
    expect(status.complete).toBe(false);
  });

  it("lists every key result below the threshold and nothing above it", async () => {
    const threshold = resolveThresholds()["scoring.rootCauseThreshold"];
    expect(threshold).toBe(0.7);

    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: missedKeyResultId,
      score: 0.4,
      reason: "Landed 210 of 300.",
    });
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: landedKeyResultId,
      score: 0.9,
      reason: "Two days flat.",
    });

    const status = await causes();
    expect(status.threshold).toBe(threshold);
    expect(status.keyResults.map((entry) => entry.keyResultId)).toEqual([
      missedKeyResultId,
    ]);
    expect(status.keyResults[0]?.score).toBe(0.4);
    expect(status.keyResults[0]?.goalTitle).toContain("mid-market");
  });

  it("puts a key result exactly on the threshold above the line", async () => {
    // §8.4 says "below 0.7". A key result that scored exactly the threshold met
    // it, and asking a room to explain a result it did not miss is the kind of
    // boundary error that makes people stop trusting the stage.
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: missedKeyResultId,
      score: 0.7,
      reason: "Exactly the line.",
    });
    expect((await causes()).keyResults).toHaveLength(0);
  });

  it("does not need the score revealed first", async () => {
    // §8.3's reveal is about who sees an objective's roll-up. A key result's own
    // grade is what stage seven reads, and it was given in the open.
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: missedKeyResultId,
      score: 0.3,
      reason: "Missed badly.",
    });
    expect((await causes()).keyResults).toHaveLength(1);
  });

  it("records one primary cause with the canon label", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: missedKeyResultId,
      score: 0.4,
      reason: "Landed 210 of 300.",
    });
    await call("sessions.setRootCause", {
      sessionId,
      keyResultId: missedKeyResultId,
      causeKey: 3,
      detail: "The billing migration never shipped.",
    });

    const status = await causes();
    expect(status.keyResults[0]?.causeKey).toBe(3);
    // The label comes from `packages/method`, never from the row.
    expect(status.keyResults[0]?.causeLabel).toBe("Blocked by a dependency");
    expect(status.keyResults[0]?.detail).toContain("billing migration");
    expect(status.named).toBe(1);
    expect(status.complete).toBe(true);
  });

  it("replaces the cause rather than storing two", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: missedKeyResultId,
      score: 0.4,
      reason: "Landed 210 of 300.",
    });
    for (const causeKey of [1, 5]) {
      await call("sessions.setRootCause", {
        sessionId,
        keyResultId: missedKeyResultId,
        causeKey,
      });
    }

    // §8.4's own word is "primary". A key result with two causes has had the
    // question dodged rather than answered.
    const status = await causes();
    expect(status.keyResults[0]?.causeKey).toBe(5);
    expect(status.named).toBe(1);
  });

  it("refuses a cause outside the eight", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: missedKeyResultId,
      score: 0.4,
      reason: "Landed 210 of 300.",
    });
    for (const causeKey of [0, 9]) {
      await expect(
        call("sessions.setRootCause", {
          sessionId,
          keyResultId: missedKeyResultId,
          causeKey,
        }),
      ).rejects.toThrow();
    }
  });

  it("refuses a cause on a key result that did not miss", async () => {
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: landedKeyResultId,
      score: 0.9,
      reason: "Two days flat.",
    });
    // Naming a cause for a result the room hit would put an explanation in the
    // minutes for something that needs none.
    await expect(
      call("sessions.setRootCause", {
        sessionId,
        keyResultId: landedKeyResultId,
        causeKey: 1,
      }),
    ).rejects.toThrow();
  });
});

describe("the process-health survey", () => {
  it("carries §8.5's five statements from the method package", async () => {
    const status = await health();
    expect(status.statements).toHaveLength(5);
    expect(status.statements[1]?.statement).toContain("check-in cadence");
    expect(status.responses).toBe(0);
    expect(status.rhythmScore).toBeNull();
    expect(status.submitted).toBe(false);
  });

  it("counts four responses and shows the averages, which is the acceptance criterion", async () => {
    await submit([5, 4, 3, 2, 1], FACILITATOR);
    await submit([5, 4, 3, 2, 1], SECOND);
    await submit([3, 2, 1, 4, 5], THIRD);
    await submit([3, 2, 1, 4, 5], FOURTH);

    const status = await health();
    expect(status.responses).toBe(4);
    // Statement one: (5 + 5 + 3 + 3) / 4.
    expect(status.statements[0]?.average).toBeCloseTo(4, 10);
    // §8.6's rhythm score is the average of statements 2 and 5 alone.
    // Statement two averages 3, statement five averages 3.
    expect(status.rhythmScore).toBeCloseTo(3, 10);
  });

  it("cannot be submitted twice by one member", async () => {
    await submit([5, 5, 5, 5, 5]);
    await submit([1, 1, 1, 1, 1]);

    // The second submission corrects the first rather than counting again. A
    // room of one that reads as two responses is a survey nobody can trust.
    const status = await health();
    expect(status.responses).toBe(1);
    expect(status.statements[0]?.average).toBeCloseTo(1, 10);
  });

  it("stores no member id, and no read hands one back", async () => {
    for (const member of ROOM) {
      await submit([4, 4, 4, 4, 4], member);
    }

    const wb = await workerDb();
    // The column list is asserted, not just the read. A future join can only
    // attribute an answer if there is something on the row to join on.
    const { rows: columns } = await wb.admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'process_health_responses'`,
    );
    const names = columns.map((row) => row.column_name);
    expect(names).toContain("respondent_hash");
    expect(names).not.toContain("member_id");
    expect(names).not.toContain("respondent_id");
    expect(names).not.toContain("submitted_by_id");

    // And the hash is not the member id wearing a hat.
    const { rows: hashes } = await wb.admin.query<{ respondent_hash: string }>(
      "select distinct respondent_hash from process_health_responses",
    );
    expect(hashes).toHaveLength(4);
    for (const row of hashes) {
      expect(row.respondent_hash).not.toContain(facilitatorMemberId);
      expect(row.respondent_hash).not.toBe(facilitatorMemberId);
    }

    const status = await health();
    expect(JSON.stringify(status)).not.toContain(facilitatorMemberId);
  });

  it("salts the hash per review, so one member cannot be followed across them", async () => {
    await submit([4, 4, 4, 4, 4]);

    const second = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q2 review",
      scheduledFor: new Date(Date.now() + 7_200_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };
    await call("sessions.open", { id: second.id });
    await call("sessions.submitProcessHealth", {
      sessionId: second.id,
      scores: [1, 2, 3, 4, 5].map((score, index) => ({
        statementKey: index + 1,
        score,
      })),
    });

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ respondent_hash: string }>(
      "select distinct respondent_hash from process_health_responses",
    );
    // Two reviews, one person, two different hashes. Without the per-review
    // salt these would match and somebody holding the table could follow one
    // unnamed member across quarters without ever learning their name.
    expect(rows).toHaveLength(2);
  });

  it("shows the reader their own answers back without showing anybody else's", async () => {
    await submit([5, 4, 3, 2, 1], FACILITATOR);
    await submit([1, 1, 1, 1, 1], SECOND);

    const mine = await health(FACILITATOR);
    expect(mine.submitted).toBe(true);
    expect(mine.statements.map((entry) => entry.mine)).toEqual([5, 4, 3, 2, 1]);

    const theirs = await health(THIRD);
    // Somebody who has not answered sees the room's averages and no answers of
    // their own, which is a different thing from seeing zeros.
    expect(theirs.submitted).toBe(false);
    expect(theirs.statements.every((entry) => entry.mine === null)).toBe(true);
    expect(theirs.responses).toBe(2);
  });

  it("names the lowest statement, which is next cycle's process OKR", async () => {
    await submit([5, 5, 2, 5, 5]);

    const status = await health();
    // §8.5: "The lowest-scoring statement becomes next cycle's process OKR."
    // P4-T11c is what turns it into one; this is the read it will use.
    expect(status.lowest?.statementKey).toBe(3);
    expect(status.lowest?.statement).toContain("measured outcomes");
  });

  it("refuses a score outside one to five", async () => {
    for (const score of [0, 6]) {
      await expect(submit([score, 3, 3, 3, 3])).rejects.toThrow();
    }
  });

  it("refuses a partial survey", async () => {
    // Five statements, answered together. A partial submission would move an
    // average without the respondent having read the rest.
    await expect(
      call("sessions.submitProcessHealth", {
        sessionId,
        scores: [{ statementKey: 1, score: 4 }],
      }),
    ).rejects.toThrow();
  });
});
