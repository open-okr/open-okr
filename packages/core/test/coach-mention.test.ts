import { describeRule } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  coachReviewDocument,
  coachReviewPoints,
} from "../src/agents/coach-review.ts";
import { dispatchOutbox, type OutboxDelivery } from "../src/outbox/handlers.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../src/rich-text/schema.ts";
import { isValidRichText } from "../src/rich-text/validate.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Mention the Coach on a goal and it reviews the goal and replies in the
 * thread (plan 0.7.0 A8, AI-NATIVE-PLAN §6.5 "Conversation").
 *
 * Approved on 9 November 2026 as a new proactive message,
 * `quality.review_requested`. Deterministic: there is no provider anywhere in
 * this file, and the review is METHOD.md §4.1 and §4.2's checks.
 */

const OWNER = "coach-mention-owner";
const SECOND = "coach-mention-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let coachMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const call = async (name: string, input: unknown, userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    name as never,
    input as never,
  );
};

/** A comment body that says something and mentions whoever is named. */
const mentioning = (
  text: string,
  ...members: { id: string; label: string }[]
) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        ...members.map((member) => ({
          type: "mention",
          attrs: { id: member.id, label: member.label },
        })),
        { type: "text", text: ` ${text}` },
      ],
    },
  ],
});

const coach = () => ({ id: coachMemberId, label: "OKR Coach" });

/** An objective that starts with an output verb, over two lagging key results. */
const outputGoal = async () => {
  const goal = (await call("goals.create", {
    title: "Launch the new onboarding website",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: ownerMemberId,
    weight: 1,
  })) as { id: string };
  for (const title of ["Activated teams", "Retained teams"]) {
    await call("goals.addKeyResult", {
      goalId: goal.id,
      title,
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 100,
      targetValue: 300,
      unit: "teams",
      weight: 1,
    });
  }
  return goal.id;
};

const mentionJobs = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    topic: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
  }>(
    "select topic, payload, idempotency_key from outbox where topic = 'agents.coach.mentioned' order by created_at",
  );
  return rows;
};

/** Delivers every pending mention row, as the relay would, and the skips. */
const deliverMentions = async () => {
  const wb = await workerDb();
  const skipped: string[] = [];
  for (const row of await mentionJobs()) {
    const delivery: OutboxDelivery = {
      topic: row.topic,
      payload: row.payload,
      idempotencyKey: row.idempotency_key,
      attempts: 0,
    };
    await dispatchOutbox(delivery, {
      pool: wb.appPool,
      onSkipped: (_delivery, reason) => skipped.push(reason),
    });
  }
  return skipped;
};

const coachReplies = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    parent_id: string | null;
    subject_id: string;
    body: unknown;
  }>(
    `select id, parent_id, subject_id, body from comments
      where workspace_id = $1 and author_member_id = $2
      order by created_at`,
    [workspaceId, coachMemberId],
  );
  return rows;
};

const reviewNudges = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    kind: string;
    subject_type: string;
    subject_id: string;
    recipient_member_id: string;
    channel: string;
    escalation_step: number;
    suppressed_reason: string | null;
    sent_at: Date | null;
  }>(
    `select kind, subject_type, subject_id, recipient_member_id, channel,
            escalation_step, suppressed_reason, sent_at
       from nudges
      where workspace_id = $1 and rule_key = 'quality.review_requested'
      order by created_at`,
    [workspaceId],
  );
  return rows;
};

/** Every text in a document, in order. */
const textOf = (node: unknown): string => {
  if (!node || typeof node !== "object") {
    return "";
  }
  const { text, content } = node as { text?: string; content?: unknown[] };
  return (text ?? "") + (content ?? []).map(textOf).join("");
};

/** The text of each bullet in a reply. */
const bulletsOf = (body: unknown): string[] => {
  const list = (
    body as { content: { type: string; content?: unknown[] }[] }
  ).content.find((node) => node.type === "bulletList");
  return (list?.content ?? []).map(textOf);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Mention Owner",
      "coach-mention-owner@example.com",
      SECOND,
      "Mention Second",
      "coach-mention-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Mention Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as {
      id: string;
    }
  ).id;
  const { rows } = await wb.admin.query<{ member_id: string }>(
    "select member_id from agents where workspace_id = $1 and kind = 'coach'",
    [workspaceId],
  );
  coachMemberId = rows[0]?.member_id as string;
  // Quiet hours off, so whether the ping went out does not depend on the hour.
  await wb.admin.query(
    "update workspace_members set quiet_hours = null where workspace_id = $1",
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the trigger is in the comment's own transaction", () => {
  it("enqueues one row when a comment on a goal mentions the Coach", async () => {
    const goalId = await outputGoal();
    const comment = (await call("comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning("can you look at this?", coach()),
    })) as { id: string };

    const jobs = await mentionJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({
      workspaceId,
      commentId: comment.id,
      goalId,
      spaceId,
    });
  });

  it("enqueues nothing for a comment without the Coach, or on something that is not a goal", async () => {
    const goalId = await outputGoal();
    await call("comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning("no mention here"),
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from key_results where goal_id = $1 limit 1",
      [goalId],
    );
    await call("comments.create", {
      subjectType: "key_result",
      subjectId: rows[0]?.id,
      body: mentioning("and this one?", coach()),
    });
    expect(await mentionJobs()).toEqual([]);
  });

  it("enqueues one when an edit newly mentions the Coach", async () => {
    const goalId = await outputGoal();
    const comment = (await call("comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning("first thoughts"),
    })) as { id: string };
    await call("comments.update", {
      commentId: comment.id,
      body: mentioning("first thoughts, and a question", coach()),
    });
    expect(await mentionJobs()).toHaveLength(1);
    await deliverMentions();
    expect((await coachReplies()).map((row) => row.parent_id)).toEqual([
      comment.id,
    ]);
  });
});

describe("the Coach reviews the goal and replies in the thread", () => {
  it("answers the comment with the §4 checks, each citing a rule the package defines", async () => {
    const goalId = await outputGoal();
    const comment = (await call("comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning("can you review this?", coach()),
    })) as { id: string };

    expect(await deliverMentions()).toEqual([]);

    const replies = await coachReplies();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      parent_id: comment.id,
      subject_id: goalId,
    });
    const body = replies[0]?.body;
    expect(isValidRichText(body, RICH_TEXT_SCHEMA_VERSION)).toBe(true);

    const bullets = bulletsOf(body);
    expect(bullets.length).toBeGreaterThan(0);
    for (const bullet of bullets) {
      const key = /Rule: (\S+)$/.exec(bullet)?.[1];
      expect(key, bullet).toBeDefined();
      expect(describeRule(key as string), bullet).not.toBeNull();
    }
    const cited = bullets.map((bullet) => /Rule: (\S+)$/.exec(bullet)?.[1]);
    // Starts with a deliverable, and the key result checks name the key
    // results they are about, by title.
    expect(cited).toContain("OBJ-1");
    expect(textOf(body)).toContain('"Activated teams"');
    // Worst first: what blocks, then warnings, then what is still to do.
    const rank = bullets.map((bullet) =>
      ["(Blocks)", "(Warning)", "(To do)"].findIndex((word) =>
        bullet.includes(word),
      ),
    );
    expect(rank.every((value) => value >= 0)).toBe(true);
    expect([...rank].sort((a, b) => a - b)).toEqual(rank);
  });

  it("records one quality.review_requested nudge to whoever asked, and audits the reply as the Coach", async () => {
    const goalId = await outputGoal();
    await call("comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning("thoughts?", coach()),
    });
    await deliverMentions();

    const nudges = await reviewNudges();
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({
      kind: "quality",
      subject_type: "goal",
      subject_id: goalId,
      recipient_member_id: ownerMemberId,
      escalation_step: 0,
      suppressed_reason: null,
    });
    expect(nudges[0]?.sent_at).toBeInstanceOf(Date);

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      actor_kind: string;
      actor_member_id: string;
    }>(
      `select actor_kind, actor_member_id from audit_events
        where workspace_id = $1 and action = 'agents.answerMention'`,
      [workspaceId],
    );
    expect(rows).toEqual([
      { actor_kind: "agent", actor_member_id: coachMemberId },
    ]);
  });

  it("answers on a company objective, which belongs to no space and is bound by name", async () => {
    const company = (await call("goals.create", {
      title: "Ship the annual report",
      cycleId,
      level: "company",
      championId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    await call("comments.create", {
      subjectType: "goal",
      subjectId: company.id,
      body: mentioning("worth a look?", coach()),
    });

    expect((await mentionJobs())[0]?.payload.spaceId).toBeNull();
    expect(await deliverMentions()).toEqual([]);
    expect((await coachReplies()).map((row) => row.subject_id)).toEqual([
      company.id,
    ]);
  });

  it("answers a comment once, however often the row is delivered", async () => {
    const goalId = await outputGoal();
    await call("comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning("once please", coach()),
    });
    await deliverMentions();
    const skipped = await deliverMentions();

    expect(skipped).toEqual(["The Coach has already answered this comment."]);
    expect(await coachReplies()).toHaveLength(1);
    expect(await reviewNudges()).toHaveLength(1);
  });

  it("answers a second question the same day, and holds the second ping as a duplicate", async () => {
    const goalId = await outputGoal();
    for (const text of ["first look?", "and again after my edit?"]) {
      await call("comments.create", {
        subjectType: "goal",
        subjectId: goalId,
        body: mentioning(text, coach()),
      });
    }
    await deliverMentions();

    expect(await coachReplies()).toHaveLength(2);
    expect((await reviewNudges()).map((row) => row.suppressed_reason)).toEqual([
      null,
      "dedup",
    ]);
  });
});

describe("least privilege, and the Coach's own settings", () => {
  it("says nothing about a goal it is not bound to, and names it nowhere", async () => {
    const goalId = await outputGoal();
    const wb = await workerDb();
    await wb.admin.query(
      `update access_bindings b set deleted_at = now()
         from access_groups g
        where g.id = b.group_id and g.member_id = $1`,
      [coachMemberId],
    );
    await call("comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning("are you there?", coach()),
    });

    const skipped = await deliverMentions();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).not.toContain("Launch the new onboarding website");
    expect(skipped[0]).not.toContain(goalId);
    expect(await coachReplies()).toEqual([]);
    expect(await reviewNudges()).toEqual([]);
    const { rows } = await wb.admin.query(
      "select 1 from audit_events where workspace_id = $1 and action = 'agents.answerMention'",
      [workspaceId],
    );
    expect(rows).toEqual([]);
  });

  it("posts nothing while the Coach is turned off or in sandbox mode", async () => {
    const goalId = await outputGoal();
    const wb = await workerDb();
    for (const setting of ["enabled = false", "autonomy = 'sandbox'"]) {
      await wb.admin.query(
        `update agents set enabled = true, autonomy = 'propose'
          where workspace_id = $1 and kind = 'coach'`,
        [workspaceId],
      );
      await wb.admin.query(
        `update agents set ${setting} where workspace_id = $1 and kind = 'coach'`,
        [workspaceId],
      );
      await wb.admin.query("delete from outbox");
      await call("comments.create", {
        subjectType: "goal",
        subjectId: goalId,
        body: mentioning("hello?", coach()),
      });
      expect(await deliverMentions()).toHaveLength(1);
    }
    expect(await coachReplies()).toEqual([]);
    expect(await reviewNudges()).toEqual([]);
  });

  it("refuses a person who calls the action as though they were the Coach", async () => {
    const goalId = await outputGoal();
    const comment = (await call("comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning("review?", coach()),
    })) as { id: string };
    await expect(
      call("agents.answerMention", {
        commentId: comment.id,
        goalId,
        spaceId,
      }),
    ).rejects.toThrow("Only the OKR Coach answers a mention of itself.");
    expect(await coachReplies()).toEqual([]);
  });
});

describe("who the composer offers", () => {
  it("offers the Coach while it is on, and never the Champion", async () => {
    const offered = (await call("agents.mentionable", {})) as {
      id: string;
      name: string;
    }[];
    expect(offered).toEqual([{ id: coachMemberId, name: "OKR Coach" }]);

    const wb = await workerDb();
    await wb.admin.query(
      "update agents set enabled = false where workspace_id = $1 and kind = 'coach'",
      [workspaceId],
    );
    expect(await call("agents.mentionable", {})).toEqual([]);
  });
});

describe("the reply itself", () => {
  const verdicts = {
    objective: [
      {
        id: "OBJ-1",
        status: "warn" as const,
        prompt: "Name the change.",
        condition: "Starts with an output verb",
        feedsStrengthScore: true,
      },
      {
        id: "OBJ-2",
        status: "pass" as const,
        prompt: "",
        condition: "Qualitative",
        feedsStrengthScore: true,
      },
    ],
    keyResults: [
      {
        id: "KR-3",
        status: "fail" as const,
        prompt: "Set a target.",
        condition: "Target missing",
        feedsStrengthScore: true,
        keyResults: [1],
      },
      {
        id: "KR-5",
        status: "info" as const,
        prompt: "Noted.",
        condition: "Activity volume",
        feedsStrengthScore: true,
        keyResults: [0],
      },
    ],
    keyResultIds: ["kr-a", "kr-b"],
  };
  const titles = new Map([
    ["kr-a", "Calls made"],
    ["kr-b", "Teams activated"],
  ]);

  it("raises what needs attention, worst first, and never a pass or a note", () => {
    const points = coachReviewPoints(verdicts, titles);
    expect(points.map((point) => [point.ruleKey, point.status])).toEqual([
      ["KR-3", "fail"],
      ["OBJ-1", "warn"],
    ]);
    expect(points[0]?.keyResults).toEqual(["Teams activated"]);
  });

  it("is valid editor JSON that cites each rule, and says so when nothing needs attention", () => {
    const body = coachReviewDocument(coachReviewPoints(verdicts, titles));
    expect(isValidRichText(body, RICH_TEXT_SCHEMA_VERSION)).toBe(true);
    expect(bulletsOf(body)).toEqual([
      'KR-3 Complete (Blocks). Target missing. Set a target. Key result: "Teams activated". Rule: KR-3',
      "OBJ-1 Outcome, not output (Warning). Starts with an output verb. Name the change. Rule: OBJ-1",
    ]);

    const clean = coachReviewDocument([]);
    expect(isValidRichText(clean, RICH_TEXT_SCHEMA_VERSION)).toBe(true);
    expect(textOf(clean)).toBe(
      "Reviewed against the quality checks in METHOD.md §4.1 and §4.2. Nothing needs attention.",
    );
  });

  it("refuses a check the package does not define rather than citing it", () => {
    expect(() =>
      coachReviewPoints(
        {
          ...verdicts,
          objective: [{ ...verdicts.objective[0], id: "OBJ-99" }] as never,
        },
        titles,
      ),
    ).toThrow("OBJ-99");
  });
});
