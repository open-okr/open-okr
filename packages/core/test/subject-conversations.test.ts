import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Comments and reactions on every subject a screen shows them on
 * (completeness review M-01, TECHNICAL-PLAN §4.10).
 *
 * The goal page was the only thread in the product. The actions accepted a key
 * result, a task and a document, and a comment on a key result then failed
 * with a raw error, because the walk from a comment up to its subject knew no
 * key result. An initiative was refused by the table itself.
 *
 * **The rule every case below checks:** a comment or a reaction is readable
 * and writable by whoever reads what it hangs on, and by nobody else. The
 * refusal is made the way `tasks.test.ts` makes one: the subject loses its
 * workspace-wide view binding, so the other member, who is in no space, can no
 * longer read it, while its owner still can.
 */

const OWNER = "talk-owner";
const OTHER = "talk-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;
let spaceId: string;
let sessionId: string;
let cycleId: string;
let goalId: string;
let keyResultId: string;
let initiativeId: string;
let taskId: string;
let documentId: string;

const call = async (name: string, input: unknown, userId = OWNER) => {
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

type Subject =
  | "goal"
  | "key_result"
  | "initiative"
  | "task"
  | "document"
  | "space"
  | "session"
  | "cycle";

const idOf = (subject: Subject): string =>
  ({
    goal: goalId,
    key_result: keyResultId,
    initiative: initiativeId,
    task: taskId,
    document: documentId,
    space: spaceId,
    session: sessionId,
    cycle: cycleId,
  })[subject];

/** The two subjects the workspace itself decides, as far as access goes. */
const workspaceWide = (subject: Subject) =>
  subject === "session" || subject === "cycle";

/**
 * Makes a subject unreadable to the other member.
 *
 * Takes the workspace-wide view binding off whatever decides who reads it. A
 * key result and a document own no context, so theirs is the goal's. A session
 * and a cycle belong to the workspace as far as access goes, so the only
 * member who cannot read one is one who reads nothing: the other member is
 * suspended.
 */
const hideFromOther = async (subject: Subject) => {
  if (workspaceWide(subject)) {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [otherMemberId],
    );
    return;
  }
  const decidedBy =
    subject === "key_result" || subject === "document"
      ? { type: "goal", id: goalId }
      : { type: subject, id: idOf(subject) };
  const wb = await workerDb();
  const { rowCount } = await wb.admin.query(
    `update access_bindings b set deleted_at = now()
       from access_contexts c, access_groups g
      where b.context_id = c.id
        and b.group_id = g.id
        and c.workspace_id = $1
        and c.resource_type = $2
        and c.resource_id = $3
        and g.kind = 'workspace_standard'
        and b.deleted_at is null`,
    [workspaceId, decidedBy.type, decidedBy.id],
  );
  // Fails here, with a reason, rather than letting every refusal below pass
  // because nothing was ever hidden.
  expect(rowCount).toBeGreaterThan(0);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Bo', $4)`,
    [OWNER, "talk-owner@example.com", OTHER, "talk-other@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = cycle.id;
  sessionId = (
    (await call("sessions.create", {
      spaceId,
      cycleId: cycle.id,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string }
  ).id;

  goalId = (
    (await call("goals.create", {
      title: "Make activation the reason teams stay",
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;

  keyResultId = (
    (await call("goals.addKeyResult", {
      goalId,
      title: "Weekly activation reaches sixty per cent",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string }
  ).id;

  initiativeId = (
    (await call("initiatives.create", {
      spaceId,
      title: "Rebuild the activation flow",
      ownerId: ownerMemberId,
      keyResultIds: [keyResultId],
    })) as { id: string }
  ).id;

  taskId = (
    (await call("tasks.create", {
      spaceId,
      title: "Rewrite the first-run screen",
      initiativeId,
    })) as { id: string }
  ).id;

  documentId = (
    (await call("documents.create", {
      subjectType: "goal",
      subjectId: goalId,
      title: "How we will win activation",
      body: paragraph("First draft."),
    })) as { id: string }
  ).id;
  // Published, so the draft rule is not what hides it from the other member.
  await call("documents.publish", { id: documentId });

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

const SUBJECTS: readonly Subject[] = [
  "goal",
  "key_result",
  "initiative",
  "task",
  "document",
];

describe.each(SUBJECTS)("a comment on a %s", (subject) => {
  it("is written, and read back by another member who reads the subject", async () => {
    const created = (await call("comments.create", {
      subjectType: subject,
      subjectId: idOf(subject),
      body: paragraph(`Said on the ${subject}.`),
    })) as { id: string };

    const theirs = (await call(
      "comments.list",
      { subjectType: subject, subjectId: idOf(subject) },
      OTHER,
    )) as { id: string; authorName: string }[];
    expect(theirs.map((one) => one.id)).toEqual([created.id]);
    expect(theirs[0]?.authorName).toBe("Ada");

    // And the other member can answer, which is what a discussion is.
    await call(
      "comments.create",
      {
        subjectType: subject,
        subjectId: idOf(subject),
        body: paragraph("And an answer."),
      },
      OTHER,
    );
    const both = (await call("comments.list", {
      subjectType: subject,
      subjectId: idOf(subject),
    })) as unknown[];
    expect(both).toHaveLength(2);
  });

  it("is refused, as not-found, to somebody who cannot read the subject", async () => {
    await call("comments.create", {
      subjectType: subject,
      subjectId: idOf(subject),
      body: paragraph("Before the subject was hidden."),
    });
    await hideFromOther(subject);

    // The owner still reads it: nothing but the other member's access moved.
    const mine = (await call("comments.list", {
      subjectType: subject,
      subjectId: idOf(subject),
    })) as unknown[];
    expect(mine).toHaveLength(1);

    await expect(
      call(
        "comments.list",
        { subjectType: subject, subjectId: idOf(subject) },
        OTHER,
      ),
    ).rejects.toThrow(/No such/);
    await expect(
      call(
        "comments.create",
        {
          subjectType: subject,
          subjectId: idOf(subject),
          body: paragraph("Written under something I cannot open."),
        },
        OTHER,
      ),
    ).rejects.toThrow(/No such/);
  });

  it("is on the feed of whoever reads the subject", async () => {
    const created = (await call("comments.create", {
      subjectType: subject,
      subjectId: idOf(subject),
      body: paragraph("Worth a line in the feed."),
    })) as { id: string };
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ context_id: string | null }>(
      `select context_id from activities
        where workspace_id = $1 and kind = 'comment.created' and subject_id = $2`,
      [workspaceId, created.id],
    );
    // A comment with no context is invisible to every feed query, which is
    // what a comment on a key result was until the walk knew where one lives.
    expect(rows[0]?.context_id).toBeTruthy();
  });
});

describe.each(SUBJECTS)("a reaction on a %s", (subject) => {
  it("is added by a reader and read back grouped", async () => {
    await call(
      "reactions.add",
      { subjectType: subject, subjectId: idOf(subject), emoji: "\u{1F44D}" },
      OTHER,
    );
    const groups = (await call("reactions.list", {
      subjectType: subject,
      subjectId: idOf(subject),
    })) as { emoji: string; count: number; own: boolean }[];
    expect(groups).toEqual([
      expect.objectContaining({ emoji: "\u{1F44D}", count: 1, own: false }),
    ]);
  });

  it("is refused, as not-found, to somebody who cannot read the subject", async () => {
    await call("reactions.add", {
      subjectType: subject,
      subjectId: idOf(subject),
      emoji: "\u{1F44D}",
    });
    await hideFromOther(subject);

    await expect(
      call(
        "reactions.list",
        { subjectType: subject, subjectId: idOf(subject) },
        OTHER,
      ),
    ).rejects.toThrow(/No such/);
    await expect(
      call(
        "reactions.add",
        { subjectType: subject, subjectId: idOf(subject), emoji: "\u{1F389}" },
        OTHER,
      ),
    ).rejects.toThrow(/No such/);
  });
});

describe("a reaction on a comment", () => {
  it("is decided by what the comment is on", async () => {
    const comment = (await call("comments.create", {
      subjectType: "initiative",
      subjectId: initiativeId,
      body: paragraph("On the work."),
    })) as { id: string };
    await call(
      "reactions.add",
      { subjectType: "comment", subjectId: comment.id, emoji: "\u{1F44D}" },
      OTHER,
    );
    await hideFromOther("initiative");
    await expect(
      call(
        "reactions.list",
        { subjectType: "comment", subjectId: comment.id },
        OTHER,
      ),
    ).rejects.toThrow(/No such/);
  });
});

describe("a draft document", () => {
  it("has no discussion, for its author or anybody else", async () => {
    const draft = (await call("documents.create", {
      subjectType: "goal",
      subjectId: goalId,
      title: "Not ready yet",
    })) as { id: string };

    // Its author is told why. A comment on a draft would be a line in the
    // goal's feed and a notification to its watchers about something they
    // cannot open.
    await expect(
      call("comments.create", {
        subjectType: "document",
        subjectId: draft.id,
        body: paragraph("A note to myself."),
      }),
    ).rejects.toThrow(/A draft has no discussion/);
    await expect(
      call("reactions.add", {
        subjectType: "document",
        subjectId: draft.id,
        emoji: "\u{1F44D}",
      }),
    ).rejects.toThrow(/A draft has no discussion/);

    // Anybody else gets what the document itself answers them: nothing.
    await expect(
      call(
        "comments.list",
        { subjectType: "document", subjectId: draft.id },
        OTHER,
      ),
    ).rejects.toThrow(/No such document/);
    await expect(
      call(
        "reactions.list",
        { subjectType: "document", subjectId: draft.id },
        OTHER,
      ),
    ).rejects.toThrow(/No such document/);
  });
});

describe("a subject nothing can hang on", () => {
  it("answers not-found rather than a raw error", async () => {
    // A key result that does not exist, and a type with no parent at all.
    await expect(
      call("comments.list", {
        subjectType: "key_result",
        subjectId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow(/No such/);
    await expect(
      call("reactions.list", { subjectType: "kpi", subjectId: goalId }),
    ).rejects.toThrow(/No such/);
  });
});

describe("who hears about a comment on the work", () => {
  it("tells whoever watches an initiative, the way a goal's watchers are told", async () => {
    await call(
      "subscriptions.toggle",
      { subjectType: "initiative", subjectId: initiativeId, subscribe: true },
      OTHER,
    );
    await call("comments.create", {
      subjectType: "initiative",
      subjectId: initiativeId,
      body: paragraph("The flow is ready for review."),
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ subject_type: string }>(
      `select subject_type from notifications
        where workspace_id = $1 and recipient_member_id = $2`,
      [workspaceId, otherMemberId],
    );
    expect(rows).toEqual([{ subject_type: "initiative" }]);
  });
});

describe("deleting a comment", () => {
  it("is its author's to do", async () => {
    const theirs = (await call(
      "comments.create",
      {
        subjectType: "task",
        subjectId: taskId,
        body: paragraph("Mine to take back."),
      },
      OTHER,
    )) as { id: string };
    await call("comments.delete", { commentId: theirs.id }, OTHER);
    const left = (await call("comments.list", {
      subjectType: "task",
      subjectId: taskId,
    })) as unknown[];
    expect(left).toEqual([]);
  });

  it("is refused to a reader who did not write it and cannot edit the subject", async () => {
    const mine = (await call("comments.create", {
      subjectType: "task",
      subjectId: taskId,
      body: paragraph("Not yours to remove."),
    })) as { id: string };
    await expect(
      call("comments.delete", { commentId: mine.id }, OTHER),
    ).rejects.toThrow(/Only its author/);
  });

  it("is open to somebody who can edit the subject, which is the moderator", async () => {
    const theirs = (await call(
      "comments.create",
      {
        subjectType: "goal",
        subjectId: goalId,
        body: paragraph("Somebody else's words."),
      },
      OTHER,
    )) as { id: string };
    // The owner is the goal's champion, and holds full on it.
    await call("comments.delete", { commentId: theirs.id });
    const left = (await call("comments.list", {
      subjectType: "goal",
      subjectId: goalId,
    })) as unknown[];
    expect(left).toEqual([]);
  });
});

/**
 * Documents on the subjects a screen now starts one from (M-01). The goal's
 * own panel is proved in `documents.test.ts`; these are the initiative, the
 * space and the session, which had the table's permission and no door.
 */
describe.each(["initiative", "space", "session", "cycle"] as const)(
  "a document on a %s",
  (subject) => {
    it("is started, published, and read by another member", async () => {
      const created = (await call("documents.create", {
        subjectType: subject,
        subjectId: idOf(subject),
        title: `Notes on the ${subject}`,
      })) as { id: string };
      await call("documents.publish", { id: created.id });

      const theirs = (await call(
        "documents.list",
        { subjectType: subject, subjectId: idOf(subject) },
        OTHER,
      )) as { id: string }[];
      expect(theirs.map((one) => one.id)).toEqual([created.id]);
    });

    it("is refused to somebody who cannot read the subject", async () => {
      const created = (await call("documents.create", {
        subjectType: subject,
        subjectId: idOf(subject),
        title: `Notes on the ${subject}`,
      })) as { id: string };
      await call("documents.publish", { id: created.id });
      await hideFromOther(subject);

      await expect(
        call(
          "documents.list",
          { subjectType: subject, subjectId: idOf(subject) },
          OTHER,
        ),
      ).rejects.toThrow(/No such/);
      await expect(
        call("documents.read", { id: created.id }, OTHER),
      ).rejects.toThrow(/No such/);
    });
  },
);

/**
 * Files on the subjects a screen now attaches them to (M-01). The action took
 * all of these since P5-T12; the panel took an initiative and a document.
 */
describe.each(["goal", "task", "space", "session", "cycle"] as const)(
  "a file on a %s",
  (subject) => {
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

    it("is attached, listed and downloaded by another member who reads the subject", async () => {
      const blobId = await upload();
      await call("attachments.attach", {
        subjectType: subject,
        subjectId: idOf(subject),
        blobId,
      });

      const listed = (await call(
        "attachments.list",
        { subjectType: subject, subjectId: idOf(subject) },
        OTHER,
      )) as { blobId: string }[];
      expect(listed.map((one) => one.blobId)).toEqual([blobId]);
      const download = (await call(
        "blobs.getForDownload",
        { blobId },
        OTHER,
      )) as { filename: string };
      expect(download.filename).toBe("plan.pdf");
    });

    it("is refused to somebody who cannot read the subject, list and download alike", async () => {
      const blobId = await upload();
      await call("attachments.attach", {
        subjectType: subject,
        subjectId: idOf(subject),
        blobId,
      });
      await hideFromOther(subject);

      await expect(
        call(
          "attachments.list",
          { subjectType: subject, subjectId: idOf(subject) },
          OTHER,
        ),
      ).rejects.toThrow(/No such/);
      await expect(
        call("blobs.getForDownload", { blobId }, OTHER),
      ).rejects.toThrow(/No such/);
    });

    it("is on the subject's own feed, not a document's", async () => {
      const blobId = await upload();
      await call("attachments.attach", {
        subjectType: subject,
        subjectId: idOf(subject),
        blobId,
      });
      const wb = await workerDb();
      const { rows } = await wb.admin.query<{
        subject_type: string;
        context_id: string | null;
      }>(
        `select subject_type, context_id from activities
          where workspace_id = $1 and kind = 'attachment.added'`,
        [workspaceId],
      );
      // Every attachment was recorded as being on a document, whatever it was
      // on, so a file on a goal resolved to no document and no feed showed it.
      // A session and a cycle own no context, and an activity with none is a
      // workspace-wide line, which is what either is as far as access goes.
      expect(rows).toEqual([
        {
          subject_type: subject,
          context_id: workspaceWide(subject) ? null : expect.any(String),
        },
      ]);
    });
  },
);
