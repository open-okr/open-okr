import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { type ImageProcessing, storeUpload } from "../src/blobs/upload.ts";
import { isBlankDocument } from "../src/people/profile.ts";
import type { RichTextDocument } from "../src/rich-text/schema.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A member's own avatar and bio (completeness review M-22, screen S-33).
 *
 * `people.updateOwnProfile` took both since P2-T03 and no screen could set
 * either. What is proved here is what the action does now that one can: an
 * avatar is an image the member could already open, stored through
 * `storeUpload`; it is shown to the rest of the workspace while it is the
 * avatar and withdrawn when it stops being one; a bio is rich text validated
 * at the boundary, and an emptied one is cleared. Each write leaves an activity
 * row and an audit row naming what changed and never its value.
 */

const OWNER = "profile-owner";
const COLLEAGUE = "profile-colleague";

let workspaceId: string;

const as = async (userId: string) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
  };
};

async function createUser(id: string, name: string) {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, name, `${id}@example.com`],
  );
}

/** A storage port that accepts everything and keeps nothing. */
const storage = {
  async put(key: string, body: Buffer) {
    return { key, size: body.byteLength };
  },
};

/** An image port that re-encodes anything into a fixed picture. */
const images: ImageProcessing = {
  async process(_body, options) {
    const encoded = {
      body: Buffer.from("pixels"),
      contentType: options.contentType,
      width: 64,
      height: 64,
    };
    return {
      kind: "processed",
      image: encoded,
      thumbnail: { ...encoded, contentType: "image/webp" },
    };
  },
};

async function upload(
  userId: string,
  filename = "face.png",
  contentType = "image/png",
): Promise<string> {
  const stored = await storeUpload(
    await as(userId),
    { storage, images },
    { filename, contentType, bytes: Buffer.from("anything") },
  );
  return stored.blobId;
}

/** Whether `userId` may open the avatar's preview, through the one door. */
async function canSee(userId: string, blobId: string): Promise<boolean> {
  try {
    await callAction(await as(userId), "blobs.getForDownload", {
      blobId,
      variant: "thumbnail",
    });
    return true;
  } catch {
    return false;
  }
}

async function ownerMember() {
  const wb = await workerDb();
  const rows = await wb.admin.query<{
    id: string;
    avatar_blob_id: string | null;
    bio: unknown;
    bio_version: number | null;
  }>(
    "select id, avatar_blob_id, bio, bio_version from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  const row = rows.rows[0];
  if (!row) {
    throw new Error("no owner member");
  }
  return row;
}

const doc = (text: string): RichTextDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await createUser(OWNER, "Owner");
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  await createUser(COLLEAGUE, "Colleague");
  const link = await callAction(
    await as(OWNER),
    "invitations.createWorkspaceLink",
    {},
  );
  await callAction(await as(COLLEAGUE), "invitations.acceptLink", {
    token: link.token,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("an avatar", () => {
  it("is set from an uploaded image and shown to the rest of the workspace", async () => {
    const face = await upload(OWNER);
    // Born private to its uploader, like every upload.
    expect(await canSee(COLLEAGUE, face)).toBe(false);

    await callAction(await as(OWNER), "people.updateOwnProfile", {
      avatarBlobId: face,
    });

    expect((await ownerMember()).avatar_blob_id).toBe(face);
    expect(await canSee(COLLEAGUE, face)).toBe(true);
  });

  it("is withdrawn from everybody else when replaced or cleared", async () => {
    const first = await upload(OWNER);
    const second = await upload(OWNER, "newer.png");
    await callAction(await as(OWNER), "people.updateOwnProfile", {
      avatarBlobId: first,
    });

    await callAction(await as(OWNER), "people.updateOwnProfile", {
      avatarBlobId: second,
    });
    expect(await canSee(COLLEAGUE, first)).toBe(false);
    expect(await canSee(COLLEAGUE, second)).toBe(true);

    await callAction(await as(OWNER), "people.updateOwnProfile", {
      avatarBlobId: null,
    });
    expect((await ownerMember()).avatar_blob_id).toBeNull();
    expect(await canSee(COLLEAGUE, second)).toBe(false);
    // The uploader still holds their own file.
    expect(await canSee(OWNER, second)).toBe(true);
  });

  it("cannot be somebody else's file, and nothing changes when refused", async () => {
    const theirs = await upload(COLLEAGUE, "private.png");

    await expect(
      callAction(await as(OWNER), "people.updateOwnProfile", {
        avatarBlobId: theirs,
      }),
    ).rejects.toThrow(/No such blob/);
    expect((await ownerMember()).avatar_blob_id).toBeNull();
    // And the refusal did not share the file with anybody.
    expect(await canSee(OWNER, theirs)).toBe(false);
  });

  it("stops being shown when its member is erased", async () => {
    const face = await upload(COLLEAGUE, "colleague.png");
    await callAction(await as(COLLEAGUE), "people.updateOwnProfile", {
      avatarBlobId: face,
    });
    expect(await canSee(OWNER, face)).toBe(true);

    const wb = await workerDb();
    const colleague = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where user_id = $1",
      [COLLEAGUE],
    );
    await callAction(await as(OWNER), "people.erase", {
      memberId: colleague.rows[0]?.id ?? "",
    });
    expect(await canSee(OWNER, face)).toBe(false);
  });

  it("must be an image", async () => {
    const pdf = await upload(OWNER, "cv.pdf", "application/pdf");
    await expect(
      callAction(await as(OWNER), "people.updateOwnProfile", {
        avatarBlobId: pdf,
      }),
    ).rejects.toThrow(/must be a PNG, JPEG, GIF or WebP/);
    expect((await ownerMember()).avatar_blob_id).toBeNull();
  });

  it("leaves an activity row and an audit row naming the change", async () => {
    const face = await upload(OWNER);
    await callAction(await as(OWNER), "people.updateOwnProfile", {
      avatarBlobId: face,
    });
    const member = await ownerMember();
    const wb = await workerDb();

    const activity = await wb.admin.query(
      "select kind from activities where subject_type = 'workspace_member' and subject_id = $1 and kind = 'member.profile_updated'",
      [member.id],
    );
    expect(activity.rows).toHaveLength(1);

    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where action = 'people.updateOwnProfile' and target_id = $1",
      [member.id],
    );
    expect(audit.rows[0]?.payload).toMatchObject({ changed: ["avatar"] });
  });
});

describe("a bio", () => {
  it("is stored as rich text with its version", async () => {
    await callAction(await as(OWNER), "people.updateOwnProfile", {
      bio: doc("Runs the growth team."),
    });
    const member = await ownerMember();
    expect(member.bio).toEqual(doc("Runs the growth team."));
    expect(member.bio_version).toBe(1);

    const wb = await workerDb();
    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where action = 'people.updateOwnProfile' and target_id = $1",
      [member.id],
    );
    // The words themselves stay out of the trail.
    expect(audit.rows[0]?.payload).toEqual({ changed: ["bio"] });
  });

  it("is refused when it is not a valid document", async () => {
    await expect(
      callAction(await as(OWNER), "people.updateOwnProfile", {
        bio: "just a string" as never,
      }),
    ).rejects.toThrow();
    await expect(
      callAction(await as(OWNER), "people.updateOwnProfile", {
        bio: { type: "doc", content: [{ type: "script" }] } as never,
      }),
    ).rejects.toThrow();
    expect((await ownerMember()).bio).toBeNull();
  });

  it("is cleared by an emptied editor rather than stored empty", async () => {
    await callAction(await as(OWNER), "people.updateOwnProfile", {
      bio: doc("Something to remove."),
    });
    await callAction(await as(OWNER), "people.updateOwnProfile", {
      bio: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect((await ownerMember()).bio).toBeNull();
  });

  it("is the member's own: an administrator's edit of another member cannot reach it", async () => {
    await callAction(await as(COLLEAGUE), "people.updateOwnProfile", {
      bio: doc("My own words."),
    });
    const wb = await workerDb();
    const colleague = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where user_id = $1",
      [COLLEAGUE],
    );
    const colleagueId = colleague.rows[0]?.id ?? "";

    // The org-field action has no bio in its schema, so the key is dropped at
    // the boundary and the member's own words are untouched.
    await callAction(await as(OWNER), "people.updateMember", {
      memberId: colleagueId,
      title: "Analyst",
      bio: doc("Words somebody else chose."),
    } as never);
    const after = await wb.admin.query<{ bio: unknown; title: string }>(
      "select bio, title from workspace_members where id = $1",
      [colleagueId],
    );
    expect(after.rows[0]?.title).toBe("Analyst");
    expect(after.rows[0]?.bio).toEqual(doc("My own words."));
  });
});

describe("isBlankDocument", () => {
  it("is true only for empty paragraphs", () => {
    expect(
      isBlankDocument({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toBe(true);
    expect(
      isBlankDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [] }, { type: "paragraph" }],
      }),
    ).toBe(true);
    expect(isBlankDocument(doc("x"))).toBe(false);
    expect(
      isBlankDocument({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "mention" }] }],
      }),
    ).toBe(false);
    expect(isBlankDocument(null)).toBe(false);
  });
});
