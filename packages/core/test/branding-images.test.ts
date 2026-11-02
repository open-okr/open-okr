import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { type ImageProcessing, storeUpload } from "../src/blobs/upload.ts";
import { BRANDING_IMAGE_MAX_BYTES } from "../src/blobs/validation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The workspace's logo and favicon (docs/design/workspace-logo-favicon.md).
 *
 * What is proved: an image becomes the logo or favicon only through
 * `settings.setWorkspaceBrandingImage`, which checks it the way an avatar is
 * checked and shares it with the workspace the way an avatar is shared; a
 * replaced or removed image stops being shared; the colour save cannot drop
 * or forge an image; and every member's screens can read the ids.
 */

const ADMIN = "branding-admin";
const MEMBER = "branding-member";

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

const storage = {
  async put(key: string, body: Buffer) {
    return { key, size: body.byteLength };
  },
};

/** Re-encodes anything into a picture of `bytes` bytes. */
const imagesOf = (bytes: number): ImageProcessing => ({
  async process(_body, options) {
    const encoded = {
      body: Buffer.alloc(bytes, 1),
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
});

async function upload(
  userId: string,
  {
    contentType = "image/png",
    bytes = 16,
  }: { contentType?: string; bytes?: number } = {},
): Promise<string> {
  const stored = await storeUpload(
    await as(userId),
    { storage, images: imagesOf(bytes) },
    { filename: "mark.png", contentType, bytes: Buffer.from("anything") },
  );
  return stored.blobId;
}

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

async function branding(): Promise<Record<string, unknown>> {
  const wb = await workerDb();
  const rows = await wb.admin.query<{ settings: Record<string, unknown> }>(
    "select settings from workspaces where id = $1",
    [workspaceId],
  );
  return (rows.rows[0]?.settings.branding ?? {}) as Record<string, unknown>;
}

const setImage = async (
  userId: string,
  slot: "logo" | "favicon",
  blobId: string | null,
) =>
  callAction(await as(userId), "settings.setWorkspaceBrandingImage", {
    slot,
    blobId,
  });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await createUser(ADMIN, "Admin");
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: ADMIN,
    name: "Admin",
  });
  workspaceId = provisioned.workspaceId;

  await createUser(MEMBER, "Member");
  const link = await callAction(
    await as(ADMIN),
    "invitations.createWorkspaceLink",
    {},
  );
  await callAction(await as(MEMBER), "invitations.acceptLink", {
    token: link.token,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a logo or favicon", () => {
  it("is stored and shown to every member", async () => {
    const logo = await upload(ADMIN);
    const favicon = await upload(ADMIN);
    expect(await canSee(MEMBER, logo)).toBe(false);

    await setImage(ADMIN, "logo", logo);
    await setImage(ADMIN, "favicon", favicon);

    expect(await branding()).toMatchObject({
      logoBlobId: logo,
      faviconBlobId: favicon,
    });
    expect(await canSee(MEMBER, logo)).toBe(true);
    expect(await canSee(MEMBER, favicon)).toBe(true);
  });

  it("is withdrawn from everybody else when replaced or removed", async () => {
    const first = await upload(ADMIN);
    const second = await upload(ADMIN);
    await setImage(ADMIN, "logo", first);
    await setImage(ADMIN, "logo", second);
    expect(await canSee(MEMBER, first)).toBe(false);
    expect(await canSee(MEMBER, second)).toBe(true);

    await setImage(ADMIN, "logo", null);
    expect((await branding()).logoBlobId).toBeNull();
    expect(await canSee(MEMBER, second)).toBe(false);
  });

  it("must be an image under the ceiling that the administrator can open", async () => {
    const pdf = await upload(ADMIN, { contentType: "application/pdf" });
    await expect(setImage(ADMIN, "logo", pdf)).rejects.toThrow(/PNG, JPEG/);

    const large = await upload(ADMIN, { bytes: BRANDING_IMAGE_MAX_BYTES + 1 });
    await expect(setImage(ADMIN, "logo", large)).rejects.toThrow(/2 MB/);

    const theirs = await upload(MEMBER);
    await expect(setImage(ADMIN, "logo", theirs)).rejects.toThrow();
    expect((await branding()).logoBlobId).toBeUndefined();
  });

  it("is refused to a member who is not an administrator", async () => {
    const mine = await upload(MEMBER);
    await expect(setImage(MEMBER, "logo", mine)).rejects.toThrow();
  });

  it("survives the colour save, which cannot set an image itself", async () => {
    const logo = await upload(ADMIN);
    await setImage(ADMIN, "logo", logo);
    const other = await upload(ADMIN);

    await callAction(await as(ADMIN), "settings.updateWorkspaceBranding", {
      branding: { primaryColor: "#4f46e5", logoBlobId: other },
    });
    expect(await branding()).toMatchObject({
      primaryColor: "#4f46e5",
      logoBlobId: logo,
    });

    await callAction(await as(ADMIN), "settings.updateWorkspaceBranding", {
      branding: {},
    });
    expect(await branding()).toEqual({ logoBlobId: logo });
  });

  it("is named to every member's screens", async () => {
    const logo = await upload(ADMIN);
    await setImage(ADMIN, "logo", logo);
    const read = await callAction(
      await as(MEMBER),
      "settings.readForMember",
      {},
    );
    expect(read.settings.branding).toMatchObject({ logoBlobId: logo });
  });

  it("leaves an activity row and an audit row naming the slot", async () => {
    const logo = await upload(ADMIN);
    await setImage(ADMIN, "logo", logo);
    const wb = await workerDb();
    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where workspace_id = $1 and action = 'settings.set_workspace_branding_image'",
      [workspaceId],
    );
    expect(audit.rows[0]?.payload).toMatchObject({ slot: "logo", set: true });
  });
});
