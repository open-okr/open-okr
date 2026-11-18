/**
 * A copilot thread reads back question first, answer second (0.9.0 UAT F-01).
 *
 * Acceptance criterion:
 *   Given a question and its answer with the same `created_at` (one
 *   transaction gives both the same `now()`), when the thread is read, then
 *   every question sits above its answer, for every turn, whatever the ids.
 *
 * The answer's id is made smaller than the question's on purpose. A time-ordered
 * id is random inside one millisecond, so the id cannot be what breaks a tie.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "copilot-order-owner";
let workspaceId: string;

const call = async (name: string, input: unknown) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId: OWNER } },
    name as never,
    input as never,
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Owner', $2)`,
    [OWNER, "copilot-order-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("copilot.thread order", () => {
  it("reads each question above its answer when both share created_at", async () => {
    const wb = await workerDb();
    let threadId: string | undefined;
    for (let turn = 1; turn <= 4; turn++) {
      const asked = (await call("copilot.ask", {
        question: `Question ${turn}`,
        ...(threadId ? { threadId } : {}),
      })) as { threadId: string };
      threadId = asked.threadId;
      // The answer: same instant as its question, id sorting before it.
      await wb.admin.query(
        `insert into ai_messages (id, workspace_id, thread_id, role, content, created_at, updated_at)
         select ('00000000-0000-7000-8000-00000000000' || $3::text)::uuid, $1, $2, 'assistant',
                'Answer ' || $3::text, m.created_at, m.created_at
         from ai_messages m
         where m.thread_id = $2 and m.content = 'Question ' || $3::text`,
        [workspaceId, threadId, turn],
      );
    }
    const read = (await call("copilot.thread", { threadId })) as {
      messages: { role: string; content: string }[];
    };
    expect(read.messages.map((m) => m.content)).toEqual([
      "Question 1",
      "Answer 1",
      "Question 2",
      "Answer 2",
      "Question 3",
      "Answer 3",
      "Question 4",
      "Answer 4",
    ]);
  });
});
