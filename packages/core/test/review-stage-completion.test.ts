/**
 * Each quarterly review stage's completion condition, shown and not enforced
 * (docs/design/sessions.md §4.1, plan 0.7.0 S1).
 *
 * Akmal decided on 9 November 2026: every stage's condition is computed and
 * shown, and an incomplete stage never refuses the advance, except stage two,
 * whose refusal METHOD.md §8.3 makes a gate ("the scoring stage does not close
 * until every one has it"). These tests hold both halves of that: what each
 * condition reads, and that only stage two still says no.
 *
 * The stage panels' own `complete` fields read the same helpers, so a panel's
 * chip and the rail cannot disagree. The last block asserts that agreement
 * where the two used to differ.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { richTextFromPlainText } from "../src/rich-text/from-text.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "completion-facilitator";
const MANAGER = "completion-manager";
const MEMBER = "completion-member";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let memberMemberId: string;
let sessionId: string;
let goalId: string;
let firstKeyResultId: string;
let secondKeyResultId: string;

interface Stage {
  stageKey: string;
  complete: boolean | null;
  missing: string | null;
  gap: { reason: string; count: number } | null;
  refusesAdvance: boolean;
}

const call = async (name: string, input: unknown, userId = FACILITATOR) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    name as never,
    input as never,
  );
};

const completion = async (id = sessionId, userId = FACILITATOR) =>
  (
    (await call("sessions.stageCompletion", { sessionId: id }, userId)) as {
      stages: Stage[];
    }
  ).stages;

const stage = async (stageKey: string, userId = FACILITATOR) => {
  const found = (await completion(sessionId, userId)).find(
    (entry) => entry.stageKey === stageKey,
  );
  if (!found) {
    throw new Error(`No stage ${stageKey} in the read.`);
  }
  return found;
};

const score = (keyResultId: string, value: number, reason = "As measured.") =>
  call("sessions.scoreKeyResult", {
    sessionId,
    keyResultId,
    score: value,
    reason,
  });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, 'Facilitator', $2), ($3, 'Manager', $4), ($5, 'Member', $6)`,
    [
      FACILITATOR,
      "completion-facilitator@example.com",
      MANAGER,
      "completion-manager@example.com",
      MEMBER,
      "completion-member@example.com",
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
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as { id: string }
  ).id;

  for (const [userId, name, role] of [
    [MANAGER, "Manager", "manager"],
    [MEMBER, "Member", "member"],
  ] as const) {
    const row = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, $3, 'active') returning id`,
      [workspaceId, userId, name],
    );
    const memberId = row.rows[0]?.id as string;
    if (userId === MEMBER) {
      memberMemberId = memberId;
    }
    await call("spaces.addMember", { spaceId, memberId, role });
  }

  goalId = (
    (await call("goals.create", {
      title: "Become the platform mid-market teams reach for first",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: facilitatorMemberId,
      reviewerId: facilitatorMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
  firstKeyResultId = (
    (await call("goals.addKeyResult", {
      goalId,
      title: "Raise weekly active teams from 120 to 300",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 120,
      targetValue: 300,
      unit: "teams",
      weight: 1,
    })) as { id: string }
  ).id;
  secondKeyResultId = (
    (await call("goals.addKeyResult", {
      goalId,
      title: "Cut median onboarding from 9 days to 2",
      direction: "reduce",
      indicatorType: "lagging",
      baselineValue: 9,
      targetValue: 2,
      unit: "days",
      weight: 1,
    })) as { id: string }
  ).id;

  sessionId = (
    (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q1 review",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string }
  ).id;
  await call("sessions.open", { id: sessionId });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("sessions.stageCompletion", () => {
  it("answers for every stage of a one-session review, in §8.1's order", async () => {
    const stages = await completion();
    expect(stages.map((entry) => entry.stageKey)).toEqual([
      "open",
      "score",
      "narratives",
      "recognition",
      "team_retro",
      "management_retro",
      "root_cause",
      "process_health",
      "keep_modify_abandon",
      "learnings",
      "actions",
    ]);
    // Only stage two's explanations gate refuses, and only while a committed
    // miss is unexplained. This review has none.
    expect(stages.every((entry) => entry.refusesAdvance === false)).toBe(true);
  });

  it("leaves the team retro without a condition, because nothing records its phases", async () => {
    // "Writing phase complete, dot voting complete" has no column behind it:
    // the board stores notes and dots, not when writing or voting ended.
    // Inventing a rule here would be practice nobody decided.
    await call("sessions.addRetroNote", {
      sessionId,
      columnKey: "worked",
      text: "The weekly check-in actually happened.",
      anonymous: false,
    });
    expect(await stage("team_retro")).toEqual({
      stageKey: "team_retro",
      complete: null,
      missing: null,
      gap: null,
      refusesAdvance: false,
    });
  });

  it("stage one: every participant has a pulse and a word", async () => {
    // Three people in the space, nobody has spoken yet.
    expect(await stage("open")).toMatchObject({
      complete: false,
      gap: { reason: "pulses", count: 3 },
      missing: "3 participants have not given a pulse and a word.",
    });

    for (const userId of [FACILITATOR, MANAGER]) {
      await call(
        "sessions.givePulse",
        { sessionId, pulse: 4, word: "steady" },
        userId,
      );
    }
    expect(await stage("open")).toMatchObject({
      complete: false,
      missing: "1 participant has not given a pulse and a word.",
    });

    await call(
      "sessions.givePulse",
      { sessionId, pulse: 3, word: "tired" },
      MEMBER,
    );
    expect(await stage("open")).toMatchObject({
      complete: true,
      missing: null,
      gap: null,
    });
  });

  it("stage two: every key result has a score and its reason", async () => {
    expect(await stage("score")).toMatchObject({
      complete: false,
      gap: { reason: "scores", count: 2 },
      missing: "2 key results have no score and reason yet.",
      refusesAdvance: false,
    });
    await score(firstKeyResultId, 0.4, "Landed 210 of 300.");
    expect((await stage("score")).missing).toBe(
      "1 key result has no score and reason yet.",
    );
    await score(secondKeyResultId, 0.9, "Two days flat.");
    expect(await stage("score")).toMatchObject({
      complete: true,
      missing: null,
    });
  });

  it("stage two says so when the review has no key results to score", async () => {
    const wb = await workerDb();
    await wb.admin.query("update goals set deleted_at = now() where id = $1", [
      goalId,
    ]);
    expect(await stage("score")).toMatchObject({
      complete: false,
      gap: { reason: "noKeyResults", count: 0 },
      missing: "This review has no key results to score.",
    });
  });

  it("stage three: every objective has been spoken for", async () => {
    expect(await stage("narratives")).toMatchObject({
      complete: false,
      missing: "1 objective has not been spoken for.",
    });
    await call("sessions.passMic", { sessionId, goalId });
    // Holding the mic is not having spoken: the pass on is what marks it.
    expect((await stage("narratives")).complete).toBe(false);
    await call("sessions.passMic", { sessionId, goalId: null });
    expect((await stage("narratives")).complete).toBe(true);
  });

  it("stage four: at least one recognition", async () => {
    expect(await stage("recognition")).toMatchObject({
      complete: false,
      missing: "Nobody has been recognised yet.",
    });
    await call("sessions.giveKudos", {
      sessionId,
      toMemberId: memberMemberId,
      text: "Rewrote the onboarding emails twice in a week.",
    });
    expect((await stage("recognition")).complete).toBe(true);
  });

  it("stage six: all four management questions answered, and the room sees only how many", async () => {
    await call(
      "sessions.setManagementAnswer",
      {
        sessionId,
        questionKey: 1,
        body: richTextFromPlainText(
          "Mostly. Two priorities competed all quarter.",
        ),
      },
      MANAGER,
    );
    // An ordinary member cannot read the answers, and the count tells them
    // nothing the activity feed did not: it announces each answer recorded.
    const seenByMember = await stage("management_retro", MEMBER);
    expect(seenByMember).toMatchObject({
      complete: false,
      gap: { reason: "answers", count: 3 },
      missing: "3 of the 4 management questions have no answer yet.",
    });
    expect(JSON.stringify(seenByMember)).not.toContain("priorities");

    for (const questionKey of [2, 3, 4]) {
      await call(
        "sessions.setManagementAnswer",
        {
          sessionId,
          questionKey,
          body: richTextFromPlainText("Answered out loud."),
        },
        MANAGER,
      );
    }
    expect((await stage("management_retro")).complete).toBe(true);
  });

  it("stage seven: nothing scored is not nothing missed", async () => {
    expect(await stage("root_cause")).toMatchObject({
      complete: false,
      gap: { reason: "notScored", count: 0 },
      missing: "No key result has been scored yet.",
    });
    await score(firstKeyResultId, 0.9);
    // Scored, and nothing below its threshold: there is no cause to name.
    expect(await stage("root_cause")).toMatchObject({
      complete: true,
      missing: null,
    });
  });

  it("stage seven: every key result below its threshold has a cause", async () => {
    await score(firstKeyResultId, 0.4, "Landed 210 of 300.");
    await score(secondKeyResultId, 0.3, "Nine days still.");
    expect(await stage("root_cause")).toMatchObject({
      complete: false,
      gap: { reason: "causes", count: 2 },
      missing: "2 key results below their threshold have no cause.",
    });
    await call("sessions.setRootCause", {
      sessionId,
      keyResultId: firstKeyResultId,
      causeKey: 3,
    });
    expect((await stage("root_cause")).missing).toBe(
      "1 key result below its threshold has no cause.",
    );
    await call("sessions.setRootCause", {
      sessionId,
      keyResultId: secondKeyResultId,
      causeKey: 4,
    });
    expect((await stage("root_cause")).complete).toBe(true);
  });

  it("stage seven reads the workspace's own threshold, not the canon's", async () => {
    await score(firstKeyResultId, 0.7);
    // Above the canon's 0.6 for an aspirational key result.
    expect((await stage("root_cause")).complete).toBe(true);

    await call("rhythm.update", {
      overrides: {
        "scoring.rootCauseThreshold": { aspirational: 0.8, committed: 1 },
      },
    });
    expect(await stage("root_cause")).toMatchObject({
      complete: false,
      gap: { reason: "causes", count: 1 },
    });
  });

  it("stage seven has no condition where the workspace leaves root causes optional", async () => {
    await score(firstKeyResultId, 0.4);
    await call("practice.update", {
      overrides: { "review.rootCauses": "optional" },
    });
    // METHOD.md §12: a miss "may be left without one". A stage that read
    // incomplete would be asking for what the workspace decided not to ask.
    expect(await stage("root_cause")).toMatchObject({
      complete: null,
      missing: null,
      gap: null,
    });
  });

  it("stage eight: every participant has scored the process, without saying who", async () => {
    const submit = (userId: string) =>
      call(
        "sessions.submitProcessHealth",
        {
          sessionId,
          scores: [4, 3, 4, 2, 5].map((value, index) => ({
            statementKey: index + 1,
            score: value,
          })),
        },
        userId,
      );
    expect(await stage("process_health")).toMatchObject({
      complete: false,
      gap: { reason: "survey", count: 3 },
      missing: "3 participants have not scored the process yet.",
    });
    await submit(MEMBER);
    // A second submission corrects the first, so it is still one person.
    await submit(MEMBER);
    const after = await stage("process_health");
    expect(after.gap).toEqual({ reason: "survey", count: 2 });
    expect(JSON.stringify(after)).not.toMatch(/Member|Manager/);

    await submit(FACILITATOR);
    await submit(MANAGER);
    expect((await stage("process_health")).complete).toBe(true);
  });

  it("stage nine: every objective has a decision", async () => {
    expect(await stage("keep_modify_abandon")).toMatchObject({
      complete: false,
      gap: { reason: "decisions", count: 1 },
      missing: "1 objective has no decision yet.",
    });
    await call("sessions.decideObjective", {
      sessionId,
      goalId,
      decision: "keep",
      why: "Still the right bet.",
    });
    expect((await stage("keep_modify_abandon")).complete).toBe(true);
  });

  it("stage ten: at least one learning", async () => {
    expect(await stage("learnings")).toMatchObject({
      complete: false,
      missing: "No learning has been captured yet.",
    });
    await call("sessions.captureLearning", {
      sessionId,
      text: "We learned that a dependency named late is a dependency missed.",
    });
    expect((await stage("learnings")).complete).toBe(true);
  });

  it("stage eleven: every action has somebody on it and a date", async () => {
    // No action is not a wish. The stage asks that each one recorded has a
    // name and a date, and the action itself refuses one without either.
    expect((await stage("actions")).complete).toBe(true);

    const due = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await call("sessions.addAction", {
      sessionId,
      what: "Write the dependency contract with the platform space",
      ownerId: memberMemberId,
      dueOn: due,
    });
    expect((await stage("actions")).complete).toBe(true);

    // An owner who has since been suspended is an action with nobody on it,
    // the wish `sessions.addAction` refuses at the boundary.
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberMemberId],
    );
    expect(await stage("actions")).toMatchObject({
      complete: false,
      gap: { reason: "owners", count: 1 },
      missing: "1 action has an owner who is no longer an active member.",
    });
  });

  it("lists only the half a review held apart walks", async () => {
    await call("practice.update", { overrides: { "review.format": "split" } });
    const reviewHalf = (
      (await call("sessions.create", {
        spaceId,
        cycleId,
        kind: "quarterly",
        title: "Q1 review",
        scheduledFor: new Date(Date.now() + 7_200_000).toISOString(),
        facilitatorId: facilitatorMemberId,
        part: "review",
      })) as { id: string }
    ).id;
    expect(
      (await completion(reviewHalf)).map((entry) => entry.stageKey),
    ).toEqual(["open", "score", "narratives", "recognition"]);
  });

  it("is a quarterly review's read only", async () => {
    const weekly = (
      (await call("sessions.create", {
        spaceId,
        cycleId,
        kind: "weekly",
        title: "Weekly check-in",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        facilitatorId: facilitatorMemberId,
      })) as { id: string }
    ).id;
    await expect(completion(weekly)).rejects.toThrow(/quarterly review/);
  });
});

describe("show, do not block", () => {
  it("advances from an incomplete stage", async () => {
    expect((await stage("open")).complete).toBe(false);
    await call("sessions.advanceStage", {
      id: sessionId,
      fromStageKey: "open",
    });
    const read = (await call("sessions.read", { id: sessionId })) as {
      stageKey: string;
    };
    expect(read.stageKey).toBe("score");
  });

  it("keeps stage two's refusal, and says so before anybody presses", async () => {
    const committedGoal = (
      (await call("goals.create", {
        title: "Enterprise security teams approve us without a fight",
        cycleId,
        spaceId,
        level: "team",
        ownerKind: "space",
        championId: facilitatorMemberId,
        kind: "committed",
        weight: 1,
      })) as { id: string }
    ).id;
    const committed = (
      (await call("goals.addKeyResult", {
        goalId: committedGoal,
        title: "Answer a security questionnaire in 5 days, from 12",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 12,
        targetValue: 5,
        unit: "days",
        weight: 1,
      })) as { id: string }
    ).id;
    await call("sessions.advanceStage", { id: sessionId });

    expect(await stage("score")).toMatchObject({
      complete: false,
      refusesAdvance: true,
    });
    await expect(
      call("sessions.advanceStage", { id: sessionId }),
    ).rejects.toThrow(/Cannot close scoring/);

    await score(committed, 0.8, "Seven days, not five.");
    // Explained now, though two aspirational key results are still ungraded:
    // incomplete, and no longer refused.
    expect(await stage("score")).toMatchObject({
      complete: false,
      refusesAdvance: false,
    });
    await call("sessions.advanceStage", { id: sessionId });
  });
});

describe("the stage panels agree with it", () => {
  it("a root-cause list with nothing below the line is complete", async () => {
    // It read incomplete until S1, because `complete` asked for at least one
    // missed key result. The rail and the panel's chip now read one answer.
    await score(firstKeyResultId, 0.9);
    const causes = (await call("sessions.rootCauses", { sessionId })) as {
      keyResults: unknown[];
      complete: boolean;
    };
    expect(causes.keyResults).toEqual([]);
    expect(causes.complete).toBe(true);
    expect((await stage("root_cause")).complete).toBe(true);
  });

  it("the scoring, narratives and reset reads say what the rail says", async () => {
    await score(firstKeyResultId, 0.4);
    const scoring = (await call("sessions.scoringStatus", { sessionId })) as {
      complete: boolean;
    };
    const narratives = (await call("sessions.narratives", { sessionId })) as {
      complete: boolean;
    };
    const reset = (await call("sessions.reset", { sessionId })) as {
      complete: boolean;
    };
    const stages = await completion();
    const byKey = new Map(stages.map((entry) => [entry.stageKey, entry]));
    expect(scoring.complete).toBe(byKey.get("score")?.complete);
    expect(narratives.complete).toBe(byKey.get("narratives")?.complete);
    expect(reset.complete).toBe(byKey.get("keep_modify_abandon")?.complete);
  });
});
