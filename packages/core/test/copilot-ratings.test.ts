/**
 * Thumbs up and down on a copilot answer (plan 0.9.0 FB1,
 * docs/design/copilot-feedback.md).
 *
 * Acceptance criteria:
 *   Given Priya presses "Poor answer", writes a note and ticks Share, then one
 *   rating row exists with her note and `shared` true, and the thread read
 *   returns it as hers.
 *   Given she presses it again, then the rating is removed.
 *   Given Ben rated without sharing, when an administrator reads the list,
 *   then his question and answer text are not in the response at all.
 *   Given a Member who is not an AI administrator, then the list is refused.
 *   Given a rating older than the retention window, when the sweep runs, then
 *   it is gone.
 *   Given a conversation is deleted, then its ratings are soft deleted with it.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { redactForFixture } from "../src/copilot/feedback-fixtures.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "ratings-owner";
const BEN = "ratings-ben";
const ADMIN_QUESTION = "Which goals are off track?";
const ADMIN_ANSWER = "Two goals are off track: onboarding and activation.";

let workspaceId: string;

const as = async (userId: string) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
  };
};

const call = async (name: string, input: unknown, userId = OWNER) =>
  callAction(await as(userId), name as never, input as never);

/**
 * A question and a recorded answer in one conversation. `copilot.ask` writes
 * the question, and the answer is written beside it the way `recordAnswer`
 * leaves it, because the model call is not what is under test.
 */
async function answered(userId = OWNER, question = ADMIN_QUESTION) {
  const asked = (await call("copilot.ask", { question }, userId)) as {
    threadId: string;
  };
  const wb = await workerDb();
  const message = await wb.admin.query<{ id: string }>(
    `insert into ai_messages (id, workspace_id, thread_id, role, content, model, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, 'assistant', $3, 'test-model', now() + interval '1 second', now() + interval '1 second')
     returning id`,
    [workspaceId, asked.threadId, ADMIN_ANSWER],
  );
  return { threadId: asked.threadId, messageId: message.rows[0]?.id as string };
}

type Row = {
  readonly member: string;
  readonly rating: string;
  readonly note: string | null;
  readonly model: string | null;
  readonly shared: boolean;
  readonly question?: string | null;
  readonly answer?: string;
};

const listed = async (input: unknown = {}, userId = OWNER) =>
  (await call("ai.answerRatings", input, userId)) as {
    rows: Row[];
    more: boolean;
  };

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Priya', $2), ($3, 'Ben', $4)`,
    [OWNER, "ratings-owner@example.com", BEN, "ratings-ben@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Priya" })
  ).workspaceId;
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Ben', 'active')`,
    [workspaceId, BEN],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("copilot.rate", () => {
  it("keeps the rating, the note and the share, and the thread returns it as hers", async () => {
    const { threadId, messageId } = await answered();
    await call("copilot.rate", {
      messageId,
      rating: "down",
      note: "  It missed the blockers.  ",
      shared: true,
    });

    const wb = await workerDb();
    const rows = await wb.admin.query<{
      rating: string;
      note: string;
      shared: boolean;
      model: string;
    }>("select rating, note, shared, model from ai_answer_ratings");
    expect(rows.rows).toEqual([
      {
        rating: "down",
        note: "It missed the blockers.",
        shared: true,
        model: "test-model",
      },
    ]);

    const thread = (await call("copilot.thread", { threadId })) as {
      messages: { id: string; myRating: unknown }[];
    };
    expect(thread.messages.find((m) => m.id === messageId)?.myRating).toEqual({
      rating: "down",
      note: "It missed the blockers.",
      shared: true,
    });
    // The member's own question has no rating to show.
    expect(thread.messages[0]?.myRating).toBeNull();
  });

  it("replaces the rating when the other thumb is pressed, without carrying the note", async () => {
    const { messageId } = await answered();
    await call("copilot.rate", {
      messageId,
      rating: "down",
      note: "Wrong",
      shared: true,
    });
    const swapped = await call("copilot.rate", { messageId, rating: "up" });
    expect(swapped).toEqual({
      messageId,
      rating: "up",
      note: null,
      shared: false,
    });

    const wb = await workerDb();
    const count = await wb.admin.query(
      "select 1 from ai_answer_ratings where deleted_at is null",
    );
    expect(count.rowCount).toBe(1);
  });

  it("keeps the note when the same value is sent again without one", async () => {
    const { messageId } = await answered();
    await call("copilot.rate", { messageId, rating: "down", note: "Wrong" });
    const again = await call("copilot.rate", {
      messageId,
      rating: "down",
      shared: true,
    });
    expect(again).toMatchObject({ note: "Wrong", shared: true });
  });

  it("refuses a note over 500 characters", async () => {
    const { messageId } = await answered();
    await expect(
      call("copilot.rate", {
        messageId,
        rating: "down",
        note: "x".repeat(501),
      }),
    ).rejects.toThrow();
  });

  it("refuses somebody else's answer and a question, as not-found", async () => {
    const theirs = await answered(BEN);
    await expect(
      call("copilot.rate", { messageId: theirs.messageId, rating: "up" }),
    ).rejects.toMatchObject({ code: "not_found" });

    const mine = await answered();
    const wb = await workerDb();
    const question = await wb.admin.query<{ id: string }>(
      "select id from ai_messages where thread_id = $1 and role = 'member'",
      [mine.threadId],
    );
    await expect(
      call("copilot.rate", { messageId: question.rows[0]?.id, rating: "up" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("audits who changed what was shared, and never the note", async () => {
    const { messageId } = await answered();
    await call("copilot.rate", {
      messageId,
      rating: "down",
      note: "private words",
      shared: true,
    });
    const wb = await workerDb();
    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where action = 'copilot.rate'",
    );
    expect(audit.rows[0]?.payload).toMatchObject({
      rating: "down",
      shared: true,
      hasNote: true,
    });
    expect(JSON.stringify(audit.rows[0]?.payload)).not.toContain("private");
  });
});

describe("copilot.unrate", () => {
  it("removes the rating, and the next thread read shows none", async () => {
    const { threadId, messageId } = await answered();
    await call("copilot.rate", {
      messageId,
      rating: "down",
      note: "Wrong",
      shared: true,
    });
    expect(await call("copilot.unrate", { messageId })).toEqual({
      messageId,
      removed: true,
    });

    const thread = (await call("copilot.thread", { threadId })) as {
      messages: { id: string; myRating: unknown }[];
    };
    expect(
      thread.messages.find((m) => m.id === messageId)?.myRating,
    ).toBeNull();
    expect((await listed()).rows).toEqual([]);

    // Taking it back takes the words back too.
    const wb = await workerDb();
    const row = await wb.admin.query<{ note: string | null; shared: boolean }>(
      "select note, shared from ai_answer_ratings",
    );
    expect(row.rows).toEqual([{ note: null, shared: false }]);
  });

  it("is not an error when there is nothing to remove, and a new rating can follow", async () => {
    const { messageId } = await answered();
    expect(await call("copilot.unrate", { messageId })).toMatchObject({
      removed: false,
    });
    await call("copilot.rate", { messageId, rating: "up" });
    await call("copilot.unrate", { messageId });
    await call("copilot.rate", { messageId, rating: "down" });
    expect((await listed()).rows).toHaveLength(1);
  });
});

describe("ai.answerRatings", () => {
  it("shows an administrator the note, the model and the member, and the text only when shared", async () => {
    const priya = await answered(OWNER, "Why is activation red?");
    const ben = await answered(BEN, "Who owns onboarding?");
    await call("copilot.rate", {
      messageId: priya.messageId,
      rating: "down",
      note: "Missed the blocker",
      shared: true,
    });
    await call(
      "copilot.rate",
      { messageId: ben.messageId, rating: "down", note: "Not useful" },
      BEN,
    );

    const { rows } = await listed();
    const shared = rows.find((row) => row.member === "Priya");
    const private_ = rows.find((row) => row.member === "Ben");
    expect(shared).toMatchObject({
      rating: "down",
      note: "Missed the blocker",
      model: "test-model",
      shared: true,
      question: "Why is activation red?",
      answer: ADMIN_ANSWER,
    });
    expect(private_).toMatchObject({ note: "Not useful", shared: false });

    // Not blanked: the keys are not there, and nor is the text anywhere in
    // the response.
    expect(private_ && "question" in private_).toBe(false);
    expect(private_ && "answer" in private_).toBe(false);
    expect(JSON.stringify(private_)).not.toContain("Who owns onboarding");
    expect(JSON.stringify(private_)).not.toContain(ADMIN_ANSWER);
  });

  it("narrows to poor or good answers", async () => {
    const one = await answered();
    const two = await answered(OWNER, "Another question");
    await call("copilot.rate", { messageId: one.messageId, rating: "down" });
    await call("copilot.rate", { messageId: two.messageId, rating: "up" });
    expect(
      (await listed({ rating: "down" })).rows.map((r) => r.rating),
    ).toEqual(["down"]);
    expect((await listed({ rating: "up" })).rows.map((r) => r.rating)).toEqual([
      "up",
    ]);
  });

  it("pages newest first with a cursor", async () => {
    for (let i = 0; i < 3; i += 1) {
      const made = await answered(OWNER, `Question ${i}`);
      await call("copilot.rate", { messageId: made.messageId, rating: "up" });
    }
    const first = (await call("ai.answerRatings", { limit: 2 })) as {
      rows: { id: string; at: string }[];
      more: boolean;
    };
    expect(first.rows).toHaveLength(2);
    expect(first.more).toBe(true);
    const last = first.rows[1];
    const second = (await call("ai.answerRatings", {
      limit: 2,
      cursor: { at: last?.at, id: last?.id },
    })) as { rows: { id: string }[]; more: boolean };
    expect(second.rows).toHaveLength(1);
    expect(second.more).toBe(false);
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);
  });

  it("is refused to a member who is not an AI administrator", async () => {
    await expect(listed({}, BEN)).rejects.toMatchObject({
      code: expect.stringMatching(/not_found|forbidden/),
    });
  });
});

describe("what happens to a rating later", () => {
  it("is soft deleted with its conversation, and an administrator sees nothing of it", async () => {
    const { threadId, messageId } = await answered();
    await call("copilot.rate", {
      messageId,
      rating: "down",
      note: "Wrong",
      shared: true,
    });
    await call("copilot.deleteThread", { threadId });

    expect((await listed()).rows).toEqual([]);
    const wb = await workerDb();
    const row = await wb.admin.query<{
      deleted_at: Date | null;
      note: string | null;
      shared: boolean;
    }>("select deleted_at, note, shared from ai_answer_ratings");
    expect(row.rows[0]?.deleted_at).not.toBeNull();
    expect(row.rows[0]).toMatchObject({ note: null, shared: false });
  });

  it("is removed by the retention sweep once older than the window, and only then", async () => {
    const old = await answered(OWNER, "Old question");
    const fresh = await answered(OWNER, "Fresh question");
    await call("copilot.rate", { messageId: old.messageId, rating: "down" });
    await call("copilot.rate", { messageId: fresh.messageId, rating: "up" });
    const wb = await workerDb();
    await wb.admin.query(
      `update ai_answer_ratings set created_at = now() - interval '100 days'
        where message_id = $1`,
      [old.messageId],
    );

    const swept = await callAction(
      { pool: wb.appPool, workspaceId, actor: { kind: "system" } },
      "connections.sweepToolCalls",
      {},
    );
    expect(swept).toMatchObject({ ratingsDeleted: 1, retentionDays: 90 });
    const left = await wb.admin.query<{ message_id: string }>(
      "select message_id from ai_answer_ratings",
    );
    expect(left.rows.map((row) => row.message_id)).toEqual([fresh.messageId]);
  });

  it("is deleted with the member by erasure, and counted", async () => {
    const { messageId } = await answered(BEN, "Ben's question");
    await call("copilot.rate", { messageId, rating: "down" }, BEN);
    const wb = await workerDb();
    const ben = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where user_id = $1",
      [BEN],
    );
    const erased = (await call("people.erase", {
      memberId: ben.rows[0]?.id,
    })) as { export: { removed: { answerRatings: number } } };
    expect(erased.export.removed.answerRatings).toBe(1);
    const left = await wb.admin.query("select 1 from ai_answer_ratings");
    expect(left.rowCount).toBe(0);
  });
});

describe("redactForFixture", () => {
  const names = {
    asker: ["Priya Nair"],
    manager: ["Dirk Lang"],
    others: ["Ben Ortiz"],
  };

  it("replaces people by role word, quoted titles, emails and numbers", () => {
    const out = redactForFixture(
      'Priya asked Dirk about "Grow activation" and ben@example.com: 72% by 2026-12-31, see [2].',
      names,
    );
    expect(out).toBe(
      `[the asker] asked [the asker's manager] about "[title]" and [email]: [number]% by [number], see [2].`,
    );
  });

  it("matches a first name on its own and not inside a longer word", () => {
    expect(redactForFixture("Ben said Benefits matter", names)).toBe(
      "[a colleague] said Benefits matter",
    );
  });
});
