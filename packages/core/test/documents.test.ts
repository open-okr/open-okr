import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Documents, their versions and attachments (TECHNICAL-PLAN §4.9, P5-T12).
 *
 * The task's own test plan:
 *   - another member cannot read a draft even through a direct identifier
 *     probe, receiving not-found
 *   - publishing emits the activity and the notification while drafting does
 *     not
 *
 * Acceptance:
 *   Given a document drafted on a goal and then published, when a space member
 *   opens the goal, then they see it with a readable history of changes, and
 *   before publication they saw nothing.
 *
 * **The first block is the one that matters.** A draft is private to its author
 * and the query is what makes it so, not a filter in a component. So the probe
 * test is written the way an attacker would write it: ask for the document by
 * its exact identifier and check the answer is indistinguishable from one that
 * never existed.
 */

const AUTHOR = "doc-author";
const OTHER = "doc-other";

let workspaceId: string;
let authorMemberId: string;
let otherMemberId: string;
let spaceId: string;
let goalId: string;

const call = async (name: string, input: unknown, userId = AUTHOR) => {
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

const paragraph = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const draftOnGoal = async (title = "How we will win activation") =>
  (await call("documents.create", {
    subjectType: "goal",
    subjectId: goalId,
    title,
    body: paragraph("First draft."),
  })) as { id: string };

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Bo', $4)`,
    [AUTHOR, "doc-author@example.com", OTHER, "doc-other@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: AUTHOR,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  authorMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };

  const goal = (await call("goals.create", {
    title: "Make activation the reason teams stay",
    cycleId: cycle.id,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: authorMemberId,
    reviewerId: authorMemberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;

  const member = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Bo', 'active') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = member.rows[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a draft is private to its author, enforced in the query", () => {
  it("acceptance, first half: another member sees nothing at all", async () => {
    await draftOnGoal();
    const theirs = (await call(
      "documents.list",
      { subjectType: "goal", subjectId: goalId },
      OTHER,
    )) as unknown[];
    expect(theirs).toEqual([]);
    expect(otherMemberId.length).toBeGreaterThan(0);
  });

  it("refuses a direct identifier probe with not-found", async () => {
    const draft = await draftOnGoal();
    // Written the way somebody guessing would write it: the exact id, from an
    // account that may read the goal it hangs off.
    await expect(
      call("documents.read", { id: draft.id }, OTHER),
    ).rejects.toThrow(/No such document/);
  });

  it("answers a draft that does not exist with the same sentence", async () => {
    const draft = await draftOnGoal();
    const missing = await call(
      "documents.read",
      { id: "00000000-0000-4000-8000-000000000000" },
      OTHER,
    ).catch((error: Error) => error.message);
    const hidden = await call("documents.read", { id: draft.id }, OTHER).catch(
      (error: Error) => error.message,
    );
    // Indistinguishable, which is what makes the probe useless.
    expect(hidden).toBe(missing);
  });

  it("lets the author read their own", async () => {
    const draft = await draftOnGoal();
    const read = (await call("documents.read", { id: draft.id })) as {
      state: string;
      versionCount: number;
    };
    expect(read.state).toBe("draft");
    expect(read.versionCount).toBe(0);
  });

  it("refuses somebody who cannot read the subject either", async () => {
    const wb = await workerDb();
    const draft = await draftOnGoal();
    await call("documents.publish", { id: draft.id });
    // Suspension is the refusal this product actually has, for the reason
    // `embeddings-retrieval.test.ts` recorded at P4-T13b.
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [otherMemberId],
    );
    await expect(
      call("documents.read", { id: draft.id }, OTHER),
    ).rejects.toThrow(/No such document|No such goal/);
  });
});

describe("publishing, which is the moment anybody else hears about it", () => {
  it("writes no notification while it is a draft", async () => {
    const wb = await workerDb();
    await call("comments.subscribe", {
      subjectType: "goal",
      subjectId: goalId,
    }).catch(() => undefined);
    await draftOnGoal();

    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*) from notifications where workspace_id = $1",
      [workspaceId],
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("acceptance, second half: publishing shows it with a readable history", async () => {
    const draft = await draftOnGoal();
    const published = (await call("documents.publish", { id: draft.id })) as {
      version: number;
    };
    expect(published.version).toBe(1);

    const theirs = (await call(
      "documents.list",
      { subjectType: "goal", subjectId: goalId },
      OTHER,
    )) as { id: string; state: string; versionCount: number }[];
    expect(theirs.map((one) => one.id)).toEqual([draft.id]);
    expect(theirs[0]?.state).toBe("published");
    expect(theirs[0]?.versionCount).toBe(1);

    const read = (await call("documents.read", { id: draft.id }, OTHER)) as {
      versions: { version: number }[];
    };
    expect(read.versions.map((one) => one.version)).toEqual([1]);
  });

  it("numbers each publish, and never twice the same", async () => {
    const draft = await draftOnGoal();
    await call("documents.publish", { id: draft.id });
    await call("documents.update", {
      id: draft.id,
      body: paragraph("Second draft."),
    });
    const second = (await call("documents.publish", { id: draft.id })) as {
      version: number;
    };
    expect(second.version).toBe(2);
  });

  it("writes the activity on publish and a private one on draft", async () => {
    const wb = await workerDb();
    const draft = await draftOnGoal();
    await call("documents.publish", { id: draft.id });

    const { rows } = await wb.admin.query<{ kind: string }>(
      "select kind from activities where workspace_id = $1 and subject_type = 'document' order by at",
      [workspaceId],
    );
    expect(rows.map((row) => row.kind)).toEqual([
      "document.drafted",
      "document.published",
    ]);
  });
});

describe("the difference a reader sees between two versions", () => {
  it("names the lines that came and went", async () => {
    const draft = await draftOnGoal();
    await call("documents.publish", { id: draft.id });
    await call("documents.update", {
      id: draft.id,
      body: paragraph("Second draft."),
    });
    await call("documents.publish", { id: draft.id });

    const difference = (await call("documents.difference", {
      id: draft.id,
    })) as {
      from: number | null;
      to: number | null;
      added: number;
      removed: number;
      lines: { kind: string; text: string }[];
    };
    expect(difference.from).toBe(1);
    expect(difference.to).toBe(2);
    expect(difference.added).toBe(1);
    expect(difference.removed).toBe(1);
    expect(
      difference.lines.find((line) => line.kind === "added")?.text,
    ).toContain("Second draft");
  });

  it("says nothing about a document nobody has published", async () => {
    const draft = await draftOnGoal();
    const difference = (await call("documents.difference", {
      id: draft.id,
    })) as { to: number | null; lines: unknown[] };
    expect(difference.to).toBeNull();
    expect(difference.lines).toEqual([]);
  });

  it("is not a way to read somebody else's draft", async () => {
    const draft = await draftOnGoal();
    await expect(
      call("documents.difference", { id: draft.id }, OTHER),
    ).rejects.toThrow(/No such document/);
  });
});

describe("attachments, which go on any subject", () => {
  const upload = async () => {
    const prepared = (await call("blobs.prepareUpload", {
      filename: "plan.pdf",
      contentType: "application/pdf",
      declaredSize: 1024,
    })) as { blobId: string };
    await call("blobs.claimUpload", {
      blobId: prepared.blobId,
      actualSize: 1024,
      digest: "a".repeat(64),
    });
    return prepared.blobId;
  };

  it("hangs one on a goal and lists it back", async () => {
    const blobId = await upload();
    const attached = (await call("attachments.attach", {
      subjectType: "goal",
      subjectId: goalId,
      blobId,
    })) as { attached: boolean };
    expect(attached.attached).toBe(true);

    const list = (await call("attachments.list", {
      subjectType: "goal",
      subjectId: goalId,
    })) as { blobId: string; filename: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.filename).toBe("plan.pdf");
  });

  it("attaches the same file twice as one attachment", async () => {
    const blobId = await upload();
    await call("attachments.attach", {
      subjectType: "goal",
      subjectId: goalId,
      blobId,
    });
    const again = (await call("attachments.attach", {
      subjectType: "goal",
      subjectId: goalId,
      blobId,
    })) as { attached: boolean };
    expect(again.attached).toBe(false);
  });

  it("takes one off without touching the file", async () => {
    const wb = await workerDb();
    const blobId = await upload();
    const attached = (await call("attachments.attach", {
      subjectType: "goal",
      subjectId: goalId,
      blobId,
    })) as { id: string };
    await call("attachments.detach", { id: attached.id });

    const list = (await call("attachments.list", {
      subjectType: "goal",
      subjectId: goalId,
    })) as unknown[];
    expect(list).toEqual([]);

    // The blob is still there. Detaching says "not here", never "gone".
    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*) from blobs where id = $1 and deleted_at is null",
      [blobId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });
});
