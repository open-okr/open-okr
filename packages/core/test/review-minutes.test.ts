/**
 * The minutes (METHOD.md §8.10, screen S-25, P4-T12-a).
 *
 * The task's test plan line this row covers: the minutes are generated from what
 * the review recorded and are exportable.
 *
 * **Two absences are the point of half these tests.** The facilitator's private
 * per-stage notes stay out, because §8.1 makes them private and the screen that
 * collects them promises nobody else can see them. The management retro is
 * withheld from anybody who is not a manager or the space's coordinator, because
 * §8.7's audience was settled at P4-T11a and a shareable document is the easiest
 * place to undo an access rule by accident.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "minutes-facilitator";
const MANAGER = "minutes-manager";
const MEMBER = "minutes-member";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let managerMemberId: string;
let memberMemberId: string;
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

const minutes = async (userId = FACILITATOR) =>
  (await call("sessions.minutes", { sessionId }, userId)) as {
    title: string;
    state: string;
    summary: {
      cycleScore: number | null;
      verdict: string | null;
      objectivesReviewed: number;
      keyResultsReviewed: number;
      belowThreshold: number;
      threshold: number;
      teamPulse: number | null;
      learningsCarried: number;
      actionsAgreed: number;
    };
    scores: { keyResultTitle: string; score: number; reason: string }[];
    narratives: { goalTitle: string; excerpt: string | null }[];
    recognition: { toName: string; fromName: string; text: string }[];
    retro: { columnKey: string; text: string; votes: number }[];
    management: { question: string; body: string }[] | null;
    rootCauses: { keyResultTitle: string; cause: string }[];
    processHealth: { statement: string; average: number }[];
    decisions: { goalTitle: string; decision: string; why: string }[];
    learnings: { text: string; carryForward: boolean }[];
    drafts: { title: string; why: string }[];
    actions: { what: string; ownerName: string; dueOn: string }[];
  };

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, 'Facilitator', $2), ($3, 'Manager', $4), ($5, 'Member', $6)`,
    [
      FACILITATOR,
      "minutes-facilitator@example.com",
      MANAGER,
      "minutes-manager@example.com",
      MEMBER,
      "minutes-member@example.com",
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

  for (const [userId, name, role] of [
    [MANAGER, "Manager", "manager"],
    [MEMBER, "Member", "member"],
  ] as const) {
    const row = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, $3, 'active') returning id`,
      [workspaceId, userId, name],
    );
    const id = row.rows[0]?.id as string;
    if (role === "manager") {
      managerMemberId = id;
    } else {
      memberMemberId = id;
    }
    await call("spaces.addMember", { spaceId, memberId: id, role });
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

/** Runs a whole review, so the minutes have something to minute. */
const runTheReview = async () => {
  await call("sessions.givePulse", { sessionId, pulse: 4, word: "relieved" });
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
  await call("sessions.setNarrative", {
    sessionId,
    goalId,
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Activation held. The funnel above it did not.",
            },
          ],
        },
      ],
    },
  });
  await call("sessions.giveKudos", {
    sessionId,
    toMemberId: memberMemberId,
    text: "Rewrote the onboarding emails twice and never mentioned it.",
  });
  const note = (await call("sessions.addRetroNote", {
    sessionId,
    columnKey: "didnt",
    text: "The dependency surfaced in week nine.",
    anonymous: false,
  })) as { id: string };
  await call("sessions.castRetroVote", { sessionId, noteId: note.id });
  await call(
    "sessions.setManagementAnswer",
    {
      sessionId,
      questionKey: 4,
      body: "Between the platform space and support. Nobody owned the handover.",
    },
    MANAGER,
  );
  await call("sessions.setRootCause", {
    sessionId,
    keyResultId: missedKeyResultId,
    causeKey: 3,
    detail: "The billing migration never shipped.",
  });
  await call("sessions.submitProcessHealth", {
    sessionId,
    scores: [4, 5, 3, 4, 5].map((score, index) => ({
      statementKey: index + 1,
      score,
    })),
  });
  await call("sessions.recordDiagnostic", { sessionId });
  await call("sessions.decideObjective", {
    sessionId,
    goalId,
    decision: "modify",
    why: "The target moved when the market did.",
  });
  await call("sessions.captureLearning", {
    sessionId,
    text: "We learned that a dependency nobody owns is a dependency nobody clears.",
    carryForward: true,
  });
  await call("sessions.draftNextCycle", {
    sessionId,
    title: "Make onboarding something a team finishes in one sitting",
    why: "Three of five losses were onboarding, not features.",
  });
  await call("sessions.addAction", {
    sessionId,
    what: "Write the dependency contract with the platform space",
    ownerId: memberMemberId,
    dueOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  });
  return note;
};

describe("§8.10's executive summary", () => {
  it("counts what §8.10 lists, and nothing it does not", async () => {
    await runTheReview();

    const record = await minutes();
    // §8.10's own list: cycle score, objectives and key results reviewed, key
    // results below 0.7, team pulse, learnings carried, actions agreed.
    expect(record.summary.cycleScore).toBeCloseTo(0.65, 10);
    // 0.65 is below §11's 0.7 cycle floor and the rhythm is 5.0, so §8.6's
    // second row applies: the team ran the rhythm and still missed.
    expect(record.summary.verdict).toBe("strategy_or_quality");
    expect(record.summary.objectivesReviewed).toBe(1);
    expect(record.summary.keyResultsReviewed).toBe(2);
    expect(record.summary.threshold).toBe(0.7);
    expect(record.summary.belowThreshold).toBe(1);
    expect(record.summary.teamPulse).toBeCloseTo(4, 10);
    expect(record.summary.learningsCarried).toBe(1);
    expect(record.summary.actionsAgreed).toBe(1);
  });

  it("reads the cycle score the room was told, not one it recomputes", async () => {
    await runTheReview();
    // A score corrected after the diagnostic was read does not move the minutes:
    // a document that recalculated would disagree with the meeting it minutes.
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId: missedKeyResultId,
      score: 0.1,
      reason: "Recounted downward.",
    });

    const record = await minutes();
    expect(record.summary.cycleScore).toBeCloseTo(0.65, 10);
    // The stage record itself does move, because that is the current grade.
    expect(
      record.scores.find((row) => row.keyResultTitle.includes("weekly active"))
        ?.score,
    ).toBe(0.1);
  });

  it("is readable before the review closes, with the numbers so far", async () => {
    // A facilitator checks the minutes while the room is still in it. Nothing
    // in §8.10 says the document only exists after the close.
    const record = await minutes();
    expect(record.state).toBe("running");
    expect(record.summary.keyResultsReviewed).toBe(0);
    expect(record.summary.cycleScore).toBeNull();
  });
});

describe("every stage's record", () => {
  it("carries all eleven stages that produced anything", async () => {
    await runTheReview();
    const record = await minutes();

    expect(record.scores).toHaveLength(2);
    expect(record.scores[0]?.reason).toContain("210 of 300");
    expect(record.narratives[0]?.excerpt).toContain("Activation held");
    expect(record.recognition[0]?.toName).toBe("Member");
    expect(record.retro[0]?.votes).toBe(1);
    expect(record.rootCauses[0]?.cause).toBe("Blocked by a dependency");
    expect(record.decisions[0]?.decision).toBe("modify");
    expect(record.learnings[0]?.carryForward).toBe(true);
    expect(record.drafts[0]?.title).toContain("one sitting");
    expect(record.actions[0]?.ownerName).toBe("Member");
  });

  it("names the root cause from the method package, not from the row", async () => {
    await runTheReview();
    const record = await minutes();
    // §11 lists the taxonomy as unchangeable structure, so the document reads it
    // from `packages/method` and a row carries only its number.
    expect(record.rootCauses[0]?.cause).toBe("Blocked by a dependency");
    expect(record.rootCauses[0]?.keyResultTitle).toContain("weekly active");
  });

  it("pools the process-health answers and names no respondent", async () => {
    await runTheReview();
    const record = await minutes();

    expect(record.processHealth).toHaveLength(5);
    expect(record.processHealth[1]?.average).toBeCloseTo(5, 10);
    // The survey is anonymous and a shareable document is the last place that
    // should stop being true.
    const asText = JSON.stringify(record);
    expect(asText).not.toContain(facilitatorMemberId);
    expect(asText).not.toContain("respondentHash");
  });

  it("leaves the facilitator's private notes out", async () => {
    await call("sessions.setStageNote", {
      id: sessionId,
      note: "Pulse was low. Do not put this in the minutes.",
    });
    await runTheReview();

    // UIUX-PLAN's S-25 lists "facilitator notes" among the contents. §8.1 makes
    // them private and the screen that collects them promises nobody else can
    // see them, and METHOD.md sits above UIUX-PLAN. The line is corrected there.
    expect(JSON.stringify(await minutes())).not.toContain(
      "Do not put this in the minutes",
    );
  });
});

describe("the management retro's audience survives the export", () => {
  it("is in the minutes for a manager and the coordinator", async () => {
    await runTheReview();

    expect((await minutes(MANAGER)).management?.[0]?.body).toContain(
      "Nobody owned the handover",
    );
    // The facilitator here is the founding member and the space's coordinator.
    expect((await minutes(FACILITATOR)).management).not.toBeNull();
  });

  it("is null for an ordinary member, and their document says nothing about it", async () => {
    await runTheReview();

    const theirs = await minutes(MEMBER);
    expect(theirs.management).toBeNull();
    // Not merely hidden from a screen: absent from the payload, so an export
    // cannot leak it.
    expect(JSON.stringify(theirs)).not.toContain("Nobody owned the handover");
    // Everything else is still theirs to read.
    expect(theirs.scores).toHaveLength(2);
    expect(theirs.recognition).toHaveLength(1);
  });

  it("refuses the whole document to a suspended member", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberMemberId],
    );
    await expect(minutes(MEMBER)).rejects.toThrow();
    expect(managerMemberId).toBeTruthy();
  });
});
