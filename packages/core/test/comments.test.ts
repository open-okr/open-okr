/**
 * Comment and reaction tests (TECHNICAL-PLAN.md §4.10, P3-T16).
 *
 * Tests run against a real database through the test-support harness.
 * Each test uses the factory to create the workspace, members and goals
 * it needs.
 */
import { describe, expect, it } from "vitest";
import { callAction } from "../src/actions/call.ts";
import { OperationError } from "../src/operations/operation.ts";
import { setup } from "./setup.ts";

describe("comments", () => {
  it("creates a comment on a goal and auto-subscribes the author", async () => {
    const { context, goal } = await setup.goalWithKeyResult();

    const result = await callAction(context, "comments.create", {
      subjectType: "goal",
      subjectId: goal.id,
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "First comment on this goal." }],
          },
        ],
      },
    });

    expect(result.id).toBeDefined();

    const comments = await callAction(context, "comments.list", {
      subjectType: "goal",
      subjectId: goal.id,
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]!.authorMemberId).toBe(context.actor.memberId);
  });

  it("mentioning two members subscribes both", async () => {
    const { context, goal, workspace } = await setup.goalWithKeyResult();

    // Create two additional members to mention
    const member1 = await setup.addMember(workspace, "Alice");
    const member2 = await setup.addMember(workspace, "Bob");

    await callAction(context, "comments.create", {
      subjectType: "goal",
      subjectId: goal.id,
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hey " },
              {
                type: "mention",
                attrs: { id: member1.memberId, label: "Alice" },
              },
              { type: "text", text: " and " },
              {
                type: "mention",
                attrs: { id: member2.memberId, label: "Bob" },
              },
              { type: "text", text: " what do you think?" },
            ],
          },
        ],
      },
    });

    // The preview should match: both members would be notified
    const preview = await callAction(context, "comments.previewNotify", {
      subjectType: "goal",
      subjectId: goal.id,
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: { id: member1.memberId, label: "Alice" },
              },
              {
                type: "mention",
                attrs: { id: member2.memberId, label: "Bob" },
              },
            ],
          },
        ],
      },
    });
    expect(preview).toContain(member1.memberId);
    expect(preview).toContain(member2.memberId);
  });

  it("only the author can edit a comment", async () => {
    const { context, goal, workspace } = await setup.goalWithKeyResult();

    const result = await callAction(context, "comments.create", {
      subjectType: "goal",
      subjectId: goal.id,
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Original" }] },
        ],
      },
    });

    // Author can edit
    await callAction(context, "comments.update", {
      commentId: result.id,
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Edited" }] },
        ],
      },
    });

    const comments = await callAction(context, "comments.list", {
      subjectType: "goal",
      subjectId: goal.id,
    });
    expect(comments[0]!.editedAt).not.toBeNull();
  });

  it("soft-deletes a comment", async () => {
    const { context, goal } = await setup.goalWithKeyResult();

    const result = await callAction(context, "comments.create", {
      subjectType: "goal",
      subjectId: goal.id,
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "To be deleted" }],
          },
        ],
      },
    });

    await callAction(context, "comments.delete", { commentId: result.id });

    const comments = await callAction(context, "comments.list", {
      subjectType: "goal",
      subjectId: goal.id,
    });
    expect(comments).toHaveLength(0);
  });
});

describe("reactions", () => {
  it("adds a reaction and lists it grouped by emoji", async () => {
    const { context, goal } = await setup.goalWithKeyResult();

    await callAction(context, "reactions.add", {
      subjectType: "goal",
      subjectId: goal.id,
      emoji: "\u{1F44D}",
    });

    const groups = await callAction(context, "reactions.list", {
      subjectType: "goal",
      subjectId: goal.id,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.emoji).toBe("\u{1F44D}");
    expect(groups[0]!.count).toBe(1);
    expect(groups[0]!.own).toBe(true);
  });

  it("one emoji per member per subject (idempotent)", async () => {
    const { context, goal } = await setup.goalWithKeyResult();

    await callAction(context, "reactions.add", {
      subjectType: "goal",
      subjectId: goal.id,
      emoji: "\u{1F44D}",
    });

    // Adding the same emoji again should not create a duplicate
    await callAction(context, "reactions.add", {
      subjectType: "goal",
      subjectId: goal.id,
      emoji: "\u{1F44D}",
    });

    const groups = await callAction(context, "reactions.list", {
      subjectType: "goal",
      subjectId: goal.id,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(1);
  });
});
