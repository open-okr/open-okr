import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Attachment rows from the text (docs/design/rich-text-editor.md §11, plan
 * 0.7.0 R2).
 *
 * A file in a comment's or a document's text is an `attachment` node naming a
 * blob. Each write that saves the text records a `text` row for it, which is
 * what lets a reader of the comment or the document open the file. These tests
 * follow §11.6's acceptance criteria and D5 to D13, row by row.
 *
 * Ana writes, Ben reads the goal, and Carl owns a private file.
 */

const ANA = "text-files-ana";
const BEN = "text-files-ben";
const CARL = "text-files-carl";

let workspaceId: string;
let anaMemberId: string;
let goalId: string;

const call = async (name: string, input: unknown, userId = ANA) => {
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

/** A paragraph of words, then each blob as a ready attachment, in order. */
const text = (words: string, ...blobIds: string[]) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: words },
        ...blobIds.map((blobId) => ({
          type: "attachment",
          attrs: {
            filename: "whiteboard.png",
            contentType: "image/png",
            status: "ready",
            blobId,
          },
        })),
      ],
    },
  ],
});

/** Prepared and claimed, as the editor's upload leaves it. */
const upload = async (userId = ANA, claim = true) => {
  const prepared = (await call(
    "blobs.prepareUpload",
    {
      filename: "whiteboard.pdf",
      contentType: "application/pdf",
      declaredSize: 1024,
    },
    userId,
  )) as { blobId: string };
  if (claim) {
    await call(
      "blobs.claimUpload",
      {
        blobId: prepared.blobId,
        actualSize: 1024,
        digest: "a".repeat(64),
      },
      userId,
    );
  }
  return prepared.blobId;
};

interface Row {
  readonly id: string;
  readonly blob_id: string;
  readonly position: number;
  readonly origin: string;
  readonly live: boolean;
}

/** Every row on a subject, live or not, in position order. */
const rowsOn = async (subjectType: string, subjectId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<Row>(
    `select id, blob_id, position, origin, deleted_at is null as live
       from attachments
      where workspace_id = $1 and subject_type = $2 and subject_id = $3
      order by created_at, position`,
    [workspaceId, subjectType, subjectId],
  );
  return rows;
};

const liveOn = async (subjectType: string, subjectId: string) =>
  (await rowsOn(subjectType, subjectId)).filter((row) => row.live);

const auditPayload = async (action: string, targetId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    payload: Record<string, unknown>;
  }>(
    `select payload from audit_events
      where workspace_id = $1 and action = $2 and target_id = $3
      order by at desc limit 1`,
    [workspaceId, action, targetId],
  );
  return rows[0]?.payload;
};

const comment = async (body: unknown, userId = ANA) =>
  (await call(
    "comments.create",
    { subjectType: "goal", subjectId: goalId, body },
    userId,
  )) as { id: string };

const opens = async (blobId: string, userId: string) =>
  call("blobs.getForDownload", { blobId }, userId).then(
    () => true,
    (error: Error) => {
      if (/No such/.test(error.message)) {
        return false;
      }
      throw error;
    },
  );

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, 'Ana', $2), ($3, 'Ben', $4), ($5, 'Carl', $6)`,
    [
      ANA,
      "text-files-ana@example.com",
      BEN,
      "text-files-ben@example.com",
      CARL,
      "text-files-carl@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: ANA,
    name: "Ana",
  });
  workspaceId = provisioned.workspaceId;
  anaMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  const goal = (await call("goals.create", {
    title: "Make activation the reason teams stay",
    cycleId: cycle.id,
    spaceId: spaces[0]?.id as string,
    level: "team",
    ownerKind: "space",
    championId: anaMemberId,
    reviewerId: anaMemberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;

  for (const [userId, name] of [
    [BEN, "Ben"],
    [CARL, "Carl"],
  ] as const) {
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, $3, 'active')`,
      [workspaceId, userId, name],
    );
  }
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a comment's files", () => {
  it("records one text row for a file Ana posts, and Ben, who reads the goal, opens it", async () => {
    const blobId = await upload();
    expect(await opens(blobId, BEN)).toBe(false);

    const posted = await comment(text("The whiteboard from Monday", blobId));

    expect(await liveOn("comment", posted.id)).toEqual([
      expect.objectContaining({ blob_id: blobId, origin: "text", position: 1 }),
    ]);
    expect(await opens(blobId, BEN)).toBe(true);
  });

  it("soft-deletes the row when Ana edits the file out, and Ben can no longer open it", async () => {
    const blobId = await upload();
    const posted = await comment(text("The whiteboard", blobId));

    await call("comments.update", {
      commentId: posted.id,
      body: text("Never mind the whiteboard"),
    });

    expect(await liveOn("comment", posted.id)).toEqual([]);
    expect(await rowsOn("comment", posted.id)).toHaveLength(1);
    expect(await opens(blobId, BEN)).toBe(false);
  });

  it("leaves the rows alone when an edit changes only words", async () => {
    const blobId = await upload();
    const posted = await comment(text("The whiteboard", blobId));
    const [before] = await liveOn("comment", posted.id);

    await call("comments.update", {
      commentId: posted.id,
      body: text("The whiteboard, again", blobId),
    });

    expect(await rowsOn("comment", posted.id)).toEqual([before]);
  });

  it("writes a new row when a file taken out is put back", async () => {
    const blobId = await upload();
    const posted = await comment(text("The whiteboard", blobId));
    await call("comments.update", {
      commentId: posted.id,
      body: text("Gone"),
    });
    await call("comments.update", {
      commentId: posted.id,
      body: text("Back", blobId),
    });

    const rows = await rowsOn("comment", posted.id);
    expect(rows.map((row) => row.live)).toEqual([false, true]);
  });

  it("refuses Carl's private file in Ana's comment with not-found, and no comment exists", async () => {
    const carls = await upload(CARL);

    await expect(comment(text("Look at this", carls))).rejects.toThrow(
      "A file in this text is not one you can share here.",
    );
    const listed = (await call("comments.list", {
      subjectType: "goal",
      subjectId: goalId,
    })) as unknown[];
    expect(listed).toEqual([]);
    expect(await opens(carls, BEN)).toBe(false);
  });

  it("refuses a file that was prepared and never claimed", async () => {
    const pending = await upload(ANA, false);
    await expect(comment(text("Half a file", pending))).rejects.toThrow(
      "never finished uploading",
    );
  });

  it("refuses a file that does not exist with the same sentence as one that is not yours", async () => {
    await expect(
      comment(text("Nothing", "00000000-0000-4000-8000-000000000000")),
    ).rejects.toThrow("A file in this text is not one you can share here.");
  });

  it("puts new files after the highest position, in the order they appear", async () => {
    const first = await upload();
    const second = await upload();
    const third = await upload();
    const posted = await comment(text("Two", first, second));

    await call("comments.update", {
      commentId: posted.id,
      body: text("Three", third, first, second),
    });

    expect(
      (await liveOn("comment", posted.id)).map((row) => [
        row.blob_id,
        row.position,
      ]),
    ).toEqual([
      [first, 1],
      [second, 2],
      [third, 3],
    ]);
  });

  it("closes a deleted comment's files with it", async () => {
    const blobId = await upload();
    const posted = await comment(text("The whiteboard", blobId));
    expect(await opens(blobId, BEN)).toBe(true);

    await call("comments.delete", { commentId: posted.id });

    // The row stays, as the document delete leaves its rows (D9).
    expect(await liveOn("comment", posted.id)).toHaveLength(1);
    expect(await opens(blobId, BEN)).toBe(false);
  });

  it("names the files each write added and removed in its audit row, by id", async () => {
    const kept = await upload();
    const dropped = await upload();
    const added = await upload();
    const posted = await comment(text("Two", kept, dropped));
    expect(await auditPayload("comments.create", posted.id)).toMatchObject({
      attachmentsAdded: [kept, dropped],
      attachmentsRemoved: [],
    });

    await call("comments.update", {
      commentId: posted.id,
      body: text("Swapped", kept, added),
    });
    expect(await auditPayload("comments.update", posted.id)).toMatchObject({
      attachmentsAdded: [added],
      attachmentsRemoved: [dropped],
    });
  });

  it("is not a subject the files panel offers", async () => {
    const blobId = await upload();
    const posted = await comment(text("The whiteboard", blobId));
    await expect(
      call("attachments.attach", {
        subjectType: "comment",
        subjectId: posted.id,
        blobId,
      }),
    ).rejects.toThrow();
    await expect(
      call("attachments.list", {
        subjectType: "comment",
        subjectId: posted.id,
      }),
    ).rejects.toThrow();
  });
});

describe("an imported comment's files", () => {
  const legacy = { type: "flowyteam", id: "task_comments:4" };

  it("records a text row for the image an import's second phase put in", async () => {
    const blobId = await upload();
    const imported = (await call("comments.importComment", {
      subjectType: "goal",
      subjectId: goalId,
      authorMemberId: anaMemberId,
      body: text("Look"),
      createdAt: "2024-03-01T09:00:00Z",
      legacy,
    })) as { id: string };
    expect(await liveOn("comment", imported.id)).toEqual([]);

    await call("comments.replaceImportedBody", {
      commentId: imported.id,
      body: text("Look", blobId),
      attachments: 1,
    });

    expect(await liveOn("comment", imported.id)).toEqual([
      expect.objectContaining({ blob_id: blobId, origin: "text" }),
    ]);
    expect(await opens(blobId, BEN)).toBe(true);
    expect(
      await auditPayload("comments.replaceImportedBody", imported.id),
    ).toMatchObject({ attachmentsAdded: [blobId], attachmentsRemoved: [] });
  });

  it("records a text row for a file an imported comment already names", async () => {
    const blobId = await upload();
    const imported = (await call("comments.importComment", {
      subjectType: "goal",
      subjectId: goalId,
      authorMemberId: anaMemberId,
      body: text("Look", blobId),
      createdAt: "2024-03-01T09:00:00Z",
      legacy,
    })) as { id: string };

    expect(await liveOn("comment", imported.id)).toHaveLength(1);
    expect(
      await auditPayload("comments.importComment", imported.id),
    ).toMatchObject({ attachmentsAdded: [blobId] });
  });
});

describe("a document's files", () => {
  const draft = async (body: unknown) =>
    (await call("documents.create", {
      subjectType: "goal",
      subjectId: goalId,
      title: "How we will win activation",
      body,
    })) as { id: string };

  it("records the text's files on create, and a published version's file still opens after the draft drops it", async () => {
    const blobId = await upload();
    const document = await draft(text("The plan", blobId));
    expect(await auditPayload("documents.create", document.id)).toMatchObject({
      attachmentsAdded: [blobId],
    });
    await call("documents.publish", { id: document.id });
    expect(await opens(blobId, BEN)).toBe(true);

    await call("documents.update", {
      id: document.id,
      body: text("The plan, without the picture"),
    });

    expect(await liveOn("document", document.id)).toHaveLength(1);
    expect(await opens(blobId, BEN)).toBe(true);
  });

  it("soft-deletes a file that was only ever in an unpublished draft", async () => {
    const blobId = await upload();
    const document = await draft(text("The plan", blobId));

    await call("documents.update", {
      id: document.id,
      body: text("The plan, without the picture"),
    });

    expect(await liveOn("document", document.id)).toEqual([]);
    expect(await auditPayload("documents.update", document.id)).toMatchObject({
      attachmentsAdded: [],
      attachmentsRemoved: [blobId],
    });
  });

  it("keeps a draft's file to its author until it is published", async () => {
    const blobId = await upload();
    await draft(text("The plan", blobId));
    expect(await opens(blobId, BEN)).toBe(false);
  });

  it("never touches a file attached through the panel when the body is edited", async () => {
    const panelFile = await upload();
    const document = await draft(text("The plan"));
    await call("attachments.attach", {
      subjectType: "document",
      subjectId: document.id,
      blobId: panelFile,
    });

    await call("documents.update", {
      id: document.id,
      body: text("The plan, rewritten"),
    });

    expect(await liveOn("document", document.id)).toEqual([
      expect.objectContaining({ blob_id: panelFile, origin: "panel" }),
    ]);
  });

  it("adds nothing for a file the panel already attached, and leaves it a panel row", async () => {
    const blobId = await upload();
    const document = await draft(text("The plan"));
    await call("attachments.attach", {
      subjectType: "document",
      subjectId: document.id,
      blobId,
    });

    await call("documents.update", {
      id: document.id,
      body: text("The plan", blobId),
    });
    await call("documents.update", {
      id: document.id,
      body: text("The plan"),
    });

    expect(await liveOn("document", document.id)).toEqual([
      expect.objectContaining({ blob_id: blobId, origin: "panel" }),
    ]);
  });

  it("leaves the rows alone on a title-only update", async () => {
    const blobId = await upload();
    const document = await draft(text("The plan", blobId));

    await call("documents.update", { id: document.id, title: "Renamed" });

    expect(await liveOn("document", document.id)).toHaveLength(1);
    expect(await auditPayload("documents.update", document.id)).toMatchObject({
      attachmentsAdded: [],
      attachmentsRemoved: [],
    });
  });

  it("lists a text row with its origin, and refuses to detach it", async () => {
    const blobId = await upload();
    const document = await draft(text("The plan", blobId));

    const listed = (await call("attachments.list", {
      subjectType: "document",
      subjectId: document.id,
    })) as { id: string; origin: string }[];
    expect(listed.map((one) => one.origin)).toEqual(["text"]);

    await expect(
      call("attachments.detach", { id: listed[0]?.id as string }),
    ).rejects.toThrow(
      "This file is in the text. Take it out of the text instead.",
    );
    expect(await liveOn("document", document.id)).toHaveLength(1);
  });
});
