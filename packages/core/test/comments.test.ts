/**
 * Comment and reaction tests (TECHNICAL-PLAN.md §4.10, P3-T16).
 *
 * Against a real database through the test-support harness.
 */
import { workerDb } from "@openokr/test-support/db";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { callAction } from "../src/actions/registry.ts";
import type { RichTextDocument } from "../src/rich-text/schema.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "comment-owner";
const SECOND = "comment-second";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const richText = (text: string): RichTextDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Comment Owner",
      "comment-owner@example.com",
      SECOND,
      "Second Member",
      "comment-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Comment Owner",
  });
  workspaceId = provisioned.workspaceId;

  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = current?.id as string;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerMemberId = members.rows.find((row) => row.user_id === OWNER)
    ?.id as string;

  // Add a second member
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Second Member', 'active') returning id`,
    [workspaceId, SECOND],
  );
  const secondRow = second.rows[0];
  if (!secondRow) {
    // Fails here with a reason, rather than letting an undefined member id
    // reach four tests that would each fail for a different-looking cause.
    throw new Error("the second member was not inserted");
  }
  secondMemberId = secondRow.id;
});

async function createGoal(): Promise<string> {
  const wb = await workerDb();
  const goal = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: "Test goal for comments",
      level: "company" as const,
      ownerKind: "member" as const,
      // `goals_owner_matches_kind` refuses a member-owned goal with no member
      // on it, which is what this fixture was doing: the suite could never
      // have passed against a real database.
      memberId: ownerMemberId,
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 100,
      cycleId,
    },
  );
  return goal.id;
}

describe("comments", () => {
  it("creates a comment and lists it back", async () => {
    const wb = await workerDb();
    const goalId = await createGoal();

    await callAction({ pool: wb.appPool, ...context() }, "comments.create", {
      subjectType: "goal" as const,
      subjectId: goalId,
      body: richText("First comment on this goal."),
    });

    const list = await callAction(
      { pool: wb.appPool, ...context() },
      "comments.list",
      { subjectType: "goal" as const, subjectId: goalId },
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.authorName).toBe("Comment Owner");
  });

  it("soft-deletes a comment", async () => {
    const wb = await workerDb();
    const goalId = await createGoal();

    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "comments.create",
      {
        subjectType: "goal" as const,
        subjectId: goalId,
        body: richText("To be deleted."),
      },
    );

    await callAction({ pool: wb.appPool, ...context() }, "comments.delete", {
      commentId: created.id,
    });

    const list = await callAction(
      { pool: wb.appPool, ...context() },
      "comments.list",
      { subjectType: "goal" as const, subjectId: goalId },
    );
    expect(list).toHaveLength(0);
  });

  it("mentions two members and the preview matches", async () => {
    const wb = await workerDb();
    const goalId = await createGoal();

    const bodyWithMentions = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hey " },
            {
              type: "mention",
              attrs: { id: ownerMemberId, label: "Owner" },
            },
            { type: "text", text: " and " },
            {
              type: "mention",
              attrs: { id: secondMemberId, label: "Second" },
            },
          ],
        },
      ],
    };

    const preview = await callAction(
      { pool: wb.appPool, ...context() },
      "comments.previewNotify",
      {
        subjectType: "goal" as const,
        subjectId: goalId,
        body: bodyWithMentions,
      },
    );
    expect(preview).toContain(ownerMemberId);
    expect(preview).toContain(secondMemberId);
  });
});

/**
 * The write boundary holds a typed comment to the rich text schema, as it
 * already held an imported one. Both actions took `z.unknown()`, so anything
 * an API client sent was stored as the body.
 */
describe("a comment body that is not editor JSON", () => {
  const notADocument = [
    ["a plain string", "just text"],
    [
      "a node the schema does not allow",
      { type: "doc", content: [{ type: "script", text: "alert(1)" }] },
    ],
    [
      "a link to javascript:",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "click",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  ] as const;

  for (const [what, refused] of notADocument) {
    // Typed as a document so it reaches the schema, which is what is tested.
    const body = refused as never;
    it(`is refused on create: ${what}`, async () => {
      const wb = await workerDb();
      const goalId = await createGoal();

      await expect(
        callAction({ pool: wb.appPool, ...context() }, "comments.create", {
          subjectType: "goal" as const,
          subjectId: goalId,
          body,
        }),
      ).rejects.toBeInstanceOf(ZodError);

      const list = await callAction(
        { pool: wb.appPool, ...context() },
        "comments.list",
        { subjectType: "goal" as const, subjectId: goalId },
      );
      expect(list).toHaveLength(0);
    });

    it(`is refused on edit, and the comment keeps its body: ${what}`, async () => {
      const wb = await workerDb();
      const goalId = await createGoal();
      const original = richText("What I meant to say.");
      const created = await callAction(
        { pool: wb.appPool, ...context() },
        "comments.create",
        { subjectType: "goal" as const, subjectId: goalId, body: original },
      );

      await expect(
        callAction({ pool: wb.appPool, ...context() }, "comments.update", {
          commentId: created.id,
          body,
        }),
      ).rejects.toBeInstanceOf(ZodError);

      const list = await callAction(
        { pool: wb.appPool, ...context() },
        "comments.list",
        { subjectType: "goal" as const, subjectId: goalId },
      );
      expect(list[0]?.body).toEqual(original);
    });
  }
});

/**
 * Who hears about a comment (completeness review H-13). A mention subscribed
 * the person and told them nothing, and a new comment told no one.
 */
describe("who a comment tells", () => {
  const mentioning = (memberId: string, text: string): RichTextDocument => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { id: memberId, label: "Somebody" } },
          { type: "text", text: ` ${text}` },
        ],
      },
    ],
  });

  const notified = async (memberId: string) => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      reason: string;
      subject_type: string;
    }>(
      `select reason, subject_type from notifications
        where workspace_id = $1 and recipient_member_id = $2
        order by created_at`,
      [workspaceId, memberId],
    );
    return rows;
  };

  it("tells a mentioned member, as a mention, and never the author", async () => {
    const wb = await workerDb();
    const goalId = await createGoal();
    await callAction({ pool: wb.appPool, ...context() }, "comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: mentioning(secondMemberId, "can you take the pricing page?"),
    });
    expect(await notified(secondMemberId)).toEqual([
      { reason: "mentioned", subject_type: "goal" },
    ]);
    expect(await notified(ownerMemberId)).toEqual([]);
  });

  it("tells the people already in the conversation about the next comment", async () => {
    const wb = await workerDb();
    const goalId = await createGoal();
    // Posting subscribes the author, so the second member is now a watcher.
    await callAction(
      { pool: wb.appPool, ...context(SECOND) },
      "comments.create",
      { subjectType: "goal", subjectId: goalId, body: richText("First") },
    );
    await callAction({ pool: wb.appPool, ...context() }, "comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: richText("And a reply"),
    });
    expect((await notified(secondMemberId)).map((row) => row.reason)).toEqual([
      "joined",
    ]);
  });

  it("tells somebody an edit newly mentions, and nobody else a second time", async () => {
    const wb = await workerDb();
    const goalId = await createGoal();
    const created = (await callAction(
      { pool: wb.appPool, ...context() },
      "comments.create",
      { subjectType: "goal", subjectId: goalId, body: richText("Draft") },
    )) as { id: string };
    expect(await notified(secondMemberId)).toEqual([]);

    await callAction({ pool: wb.appPool, ...context() }, "comments.update", {
      commentId: created.id,
      body: mentioning(secondMemberId, "this one is yours"),
    });
    expect(await notified(secondMemberId)).toEqual([
      { reason: "mentioned", subject_type: "goal" },
    ]);

    // The same mention, edited again, is not news.
    await callAction({ pool: wb.appPool, ...context() }, "comments.update", {
      commentId: created.id,
      body: mentioning(secondMemberId, "this one is yours, by Friday"),
    });
    expect(await notified(secondMemberId)).toHaveLength(1);
  });
});

describe("reactions", () => {
  it("adds a reaction and lists it grouped", async () => {
    const wb = await workerDb();
    const goalId = await createGoal();

    await callAction({ pool: wb.appPool, ...context() }, "reactions.add", {
      subjectType: "goal",
      subjectId: goalId,
      emoji: "\u{1F44D}",
    });

    const groups = await callAction(
      { pool: wb.appPool, ...context() },
      "reactions.list",
      { subjectType: "goal", subjectId: goalId },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.emoji).toBe("\u{1F44D}");
    expect(groups[0]?.own).toBe(true);
  });

  it("is idempotent for the same emoji", async () => {
    const wb = await workerDb();
    const goalId = await createGoal();

    await callAction({ pool: wb.appPool, ...context() }, "reactions.add", {
      subjectType: "goal",
      subjectId: goalId,
      emoji: "\u{1F44D}",
    });
    await callAction({ pool: wb.appPool, ...context() }, "reactions.add", {
      subjectType: "goal",
      subjectId: goalId,
      emoji: "\u{1F44D}",
    });

    const groups = await callAction(
      { pool: wb.appPool, ...context() },
      "reactions.list",
      { subjectType: "goal", subjectId: goalId },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(1);
  });
});
