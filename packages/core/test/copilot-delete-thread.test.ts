/**
 * Deleting a copilot conversation (plan 0.8.1 CP2, review Q4).
 *
 * Acceptance criterion:
 *   Given a conversation in History, when the person deletes it, then it
 *   leaves the list, an audit row records `copilot.deleteThread`, and its
 *   address answers not-found.
 *
 * A soft delete on the thread's existing `deleted_at`, so no migration, through
 * the Operation pipeline like every other write. A thread is one member's, so
 * nobody else may delete it, and they are told not-found rather than forbidden
 * for the reason the conversation actions give.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "copilot-delete-owner";
const OTHER = "copilot-delete-other";

let workspaceId: string;

const call = async (name: string, input: unknown, userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId } },
    name as never,
    input as never,
  );
};

/** A conversation with one question in it, as `copilot.ask` records one. */
const converse = async (question: string, userId = OWNER) =>
  (
    (await call("copilot.ask", { question }, userId)) as {
      threadId: string;
    }
  ).threadId;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Owner', $2), ($3, 'Other', $4)`,
    [
      OWNER,
      "copilot-delete-owner@example.com",
      OTHER,
      "copilot-delete-other@example.com",
    ],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Other', 'active')`,
    [workspaceId, OTHER],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("copilot.deleteThread", () => {
  it("takes the conversation out of the list and answers not-found for it", async () => {
    const kept = await converse("What is blocking onboarding?");
    const gone = await converse("Summarise the open blockers");

    expect(await call("copilot.deleteThread", { threadId: gone })).toEqual({
      id: gone,
    });

    const listed = (await call("copilot.threads", {})) as { id: string }[];
    expect(listed.map((thread) => thread.id)).toEqual([kept]);
    await expect(
      call("copilot.thread", { threadId: gone }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("is soft, and audited with who did it", async () => {
    const gone = await converse("Summarise the open blockers");
    await call("copilot.deleteThread", { threadId: gone });

    const wb = await workerDb();
    const row = await wb.admin.query<{ deleted_at: Date | null }>(
      "select deleted_at from ai_threads where id = $1",
      [gone],
    );
    expect(row.rows[0]?.deleted_at).not.toBeNull();

    const audit = await wb.admin.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_events where action = 'copilot.deleteThread'",
    );
    expect(audit.rows).toEqual([
      { action: "copilot.deleteThread", target_id: gone },
    ]);
  });

  it("refuses somebody else's conversation, and leaves it", async () => {
    const theirs = await converse("What did people say?", OTHER);
    await expect(
      call("copilot.deleteThread", { threadId: theirs }),
    ).rejects.toMatchObject({ code: "not_found" });

    const listed = (await call("copilot.threads", {}, OTHER)) as {
      id: string;
    }[];
    expect(listed.map((thread) => thread.id)).toEqual([theirs]);
  });

  it("refuses one already deleted, so a second press does not audit twice", async () => {
    const gone = await converse("Summarise the open blockers");
    await call("copilot.deleteThread", { threadId: gone });
    await expect(
      call("copilot.deleteThread", { threadId: gone }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("takes a deleted conversation's cards with it", async () => {
    const gone = await converse("Create an onboarding objective");
    const wb = await workerDb();
    const proposal = await wb.admin.query<{ id: string }>(
      `insert into proposed_changes
         (id, workspace_id, run_id, thread_id, action, payload, status, ai_generated)
       values (gen_random_uuid(), $1, null, $2, 'goals.create', '{}'::jsonb, 'pending', true)
       returning id`,
      [workspaceId, gone],
    );
    await call("copilot.deleteThread", { threadId: gone });

    await expect(
      call("copilot.applyProposal", { id: proposal.rows[0]?.id }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
