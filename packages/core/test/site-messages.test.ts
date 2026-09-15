import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSiteMessage,
  dismissSiteMessage,
  listSiteMessages,
  liveSiteMessagesFor,
} from "../src/operator/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Site messages (P8-T03c, design in
 * `docs/design/p8-t01b-operator-console.md` §4).
 *
 * Three claims: the window is required rather than optional, a targeted
 * message reaches only the workspaces it names, and a dismissal belongs to
 * one person and hides it from nobody else.
 */

const OPERATOR = "site-operator";
const READER = "site-reader";
const OTHER = "site-other";

let workspaceA: string;
let workspaceB: string;

const hour = 60 * 60 * 1000;
const seedUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, id, `${id}@example.com`],
  );
};

const write = async (over: Record<string, unknown> = {}) => {
  const wb = await workerDb();
  return createSiteMessage(wb.appPool, OPERATOR, {
    body: "Maintenance on Sunday, 02:00 to 04:00 UTC.",
    startsAt: new Date(Date.now() - hour),
    endsAt: new Date(Date.now() + hour),
    ...over,
  } as Parameters<typeof createSiteMessage>[2]);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  for (const id of [OPERATOR, READER, OTHER]) {
    await seedUser(id);
  }
  workspaceA = (
    await createWorkspace(wb.appPool, { user: { id: READER, name: "Reader" } })
  ).workspaceId;
  workspaceB = (
    await createWorkspace(wb.appPool, { user: { id: OTHER, name: "Other" } })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the window is required, not optional", () => {
  it("refuses a message with no end", async () => {
    await expect(write({ endsAt: undefined })).rejects.toThrow();
  });

  it("refuses a message that ends before it starts", async () => {
    // A message with no end is a banner everybody learns to ignore, and the
    // next one is ignored with it. This is the same rule read backwards.
    await expect(
      write({
        startsAt: new Date(Date.now() + hour),
        endsAt: new Date(Date.now() - hour),
      }),
    ).rejects.toThrow(/end after it starts/);
  });

  it("refuses a blank body rather than storing an empty banner", async () => {
    await expect(write({ body: "   " })).rejects.toThrow();
  });

  it("hides a message whose window has passed, without anybody removing it", async () => {
    const wb = await workerDb();
    await write({
      startsAt: new Date(Date.now() - 3 * hour),
      endsAt: new Date(Date.now() - hour),
    });
    await expect(
      liveSiteMessagesFor(wb.appPool, READER, workspaceA),
    ).resolves.toEqual([]);
    // Still there for the operator to see, because expiring is not deleting.
    await expect(listSiteMessages(wb.appPool)).resolves.toHaveLength(1);
  });

  it("hides a message whose window has not started", async () => {
    const wb = await workerDb();
    await write({
      startsAt: new Date(Date.now() + hour),
      endsAt: new Date(Date.now() + 3 * hour),
    });
    await expect(
      liveSiteMessagesFor(wb.appPool, READER, workspaceA),
    ).resolves.toEqual([]);
  });
});

describe("targeting", () => {
  it("reaches everybody when no workspace is named", async () => {
    const wb = await workerDb();
    await write();
    await expect(
      liveSiteMessagesFor(wb.appPool, READER, workspaceA),
    ).resolves.toHaveLength(1);
    await expect(
      liveSiteMessagesFor(wb.appPool, OTHER, workspaceB),
    ).resolves.toHaveLength(1);
  });

  it("reaches only the workspaces it names", async () => {
    const wb = await workerDb();
    await write({ targetWorkspaceIds: [workspaceA] });
    await expect(
      liveSiteMessagesFor(wb.appPool, READER, workspaceA),
    ).resolves.toHaveLength(1);
    await expect(
      liveSiteMessagesFor(wb.appPool, OTHER, workspaceB),
    ).resolves.toEqual([]);
  });
});

describe("a dismissal belongs to one person", () => {
  it("hides it from them and from nobody else", async () => {
    const wb = await workerDb();
    const { id } = await write();

    await dismissSiteMessage(wb.appPool, READER, id);

    await expect(
      liveSiteMessagesFor(wb.appPool, READER, workspaceA),
    ).resolves.toEqual([]);
    // The other person has not read it, so they still see it. Keyed on the
    // user rather than the member, which is what makes somebody in three
    // workspaces dismiss an instance-wide sentence once instead of three
    // times.
    await expect(
      liveSiteMessagesFor(wb.appPool, OTHER, workspaceB),
    ).resolves.toHaveLength(1);
  });

  it("stays dismissed when the same person dismisses twice", async () => {
    const wb = await workerDb();
    const { id } = await write();
    await dismissSiteMessage(wb.appPool, READER, id);
    await expect(
      dismissSiteMessage(wb.appPool, READER, id),
    ).resolves.toBeUndefined();
  });

  it("hides it across every workspace that person is in", async () => {
    // The correction to the design, asserted. A member is per workspace; a
    // person reading a sentence is not.
    const wb = await workerDb();
    const second = await createWorkspace(wb.appPool, {
      user: { id: READER, name: "Reader" },
    });
    const { id } = await write();
    await dismissSiteMessage(wb.appPool, READER, id);

    await expect(
      liveSiteMessagesFor(wb.appPool, READER, workspaceA),
    ).resolves.toEqual([]);
    await expect(
      liveSiteMessagesFor(wb.appPool, READER, second.workspaceId),
    ).resolves.toEqual([]);
  });
});
