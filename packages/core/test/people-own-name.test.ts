import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { DEMO_PERSONAS } from "../src/demo/personas.ts";
import { createSCIMToken } from "../src/directory-sync/tokens.ts";
import { joinWorkspaceForIdentity } from "../src/workspaces/directory-join.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Changing your own name (docs/design/account-self-service.md §8 Y5, D22 to
 * D24, plan 0.8.0 Y5).
 *
 * The member's own change lands on this workspace's member row and on the
 * account's `users.name`, which a new workspace starts from. Another
 * workspace keeps the name it has, because its administrator may have set
 * it. An administrator's change of somebody else stays on the member row.
 */

const SAM = "own-name-sam";
const OTHER_OWNER = "own-name-other-owner";

let first: { workspaceId: string; memberId: string };
let second: { workspaceId: string; memberId: string };

const asSam = async (workspaceId: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId: SAM },
});

async function createUser(id: string, name: string, email: string) {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, name, email],
  );
}

const userName = async (id: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ name: string }>(
    "select name from users where id = $1",
    [id],
  );
  return rows[0]?.name;
};

const memberName = async (memberId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ name: string }>(
    "select name from workspace_members where id = $1",
    [memberId],
  );
  return rows[0]?.name;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await createUser(SAM, "Sam Original", "sam@example.com");
  await createUser(OTHER_OWNER, "Other Owner", "other-owner@example.com");
  first = await provisionWorkspaceForUser(wb.appPool, {
    id: SAM,
    name: "Sam Original",
  });
  second = await provisionWorkspaceForUser(wb.appPool, {
    id: OTHER_OWNER,
    name: "Other Owner",
  });
  // Sam is a member of the second workspace too, under the name it knows.
  const joined = await joinWorkspaceForIdentity(wb.appPool, {
    workspaceId: second.workspaceId,
    user: { id: SAM, name: "Sam Original" },
    via: "sso",
  });
  second = { workspaceId: second.workspaceId, memberId: joined.memberId };
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a member renaming themselves", () => {
  it("changes this workspace's member row and the account's name, and no other workspace's", async () => {
    const result = await callAction(
      await asSam(first.workspaceId),
      "people.updateOwnProfile",
      { name: "  Samira Renamed  " },
    );
    expect(result.name).toBe("Samira Renamed");

    expect(await memberName(first.memberId)).toBe("Samira Renamed");
    expect(await userName(SAM)).toBe("Samira Renamed");
    expect(await memberName(second.memberId)).toBe("Sam Original");
  });

  it("records which fact changed and never the name itself", async () => {
    await callAction(
      await asSam(first.workspaceId),
      "people.updateOwnProfile",
      { name: "Samira Renamed" },
    );
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ payload: unknown }>(
      `select payload from audit_events
        where workspace_id = $1 and action = 'people.updateOwnProfile'`,
      [first.workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ changed: ["name"] });
    expect(JSON.stringify(rows[0]?.payload)).not.toContain("Samira");
  });

  it("is allowed for a member a directory manages, because the sync never writes a name (AS-Q1)", async () => {
    const wb = await workerDb();
    await createSCIMToken(wb.appPool, second.workspaceId);
    await callAction(
      await asSam(second.workspaceId),
      "people.updateOwnProfile",
      { name: "Samira From The Directory" },
    );
    expect(await memberName(second.memberId)).toBe("Samira From The Directory");
    expect(await userName(SAM)).toBe("Samira From The Directory");
  });

  it("refuses an empty name and one of 201 characters, with their sentences", async () => {
    await expect(
      callAction(await asSam(first.workspaceId), "people.updateOwnProfile", {
        name: "   ",
      }),
    ).rejects.toThrow("A member needs a name.");
    await expect(
      callAction(await asSam(first.workspaceId), "people.updateOwnProfile", {
        name: "x".repeat(201),
      }),
    ).rejects.toThrow("Use at most 200 characters.");
    expect(await userName(SAM)).toBe("Sam Original");
  });

  it("leaves both names alone when the change is not a name", async () => {
    await callAction(
      await asSam(first.workspaceId),
      "people.updateOwnProfile",
      { timezone: "UTC" },
    );
    expect(await memberName(first.memberId)).toBe("Sam Original");
    expect(await userName(SAM)).toBe("Sam Original");
  });
});

describe("a demonstration account", () => {
  it("keeps its name", async () => {
    const wb = await workerDb();
    const demo = DEMO_PERSONAS[0] as { email: string; name: string };
    await createUser("own-name-demo", demo.name, demo.email);
    const joined = await joinWorkspaceForIdentity(wb.appPool, {
      workspaceId: first.workspaceId,
      user: { id: "own-name-demo", name: demo.name },
      via: "sso",
    });
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId: first.workspaceId,
          actor: { kind: "human", userId: "own-name-demo" },
        },
        "people.updateOwnProfile",
        { name: "Somebody Else" },
      ),
    ).rejects.toThrow(
      "Demonstration accounts keep their name. Anyone can sign in to them, so anyone could change it.",
    );
    expect(await memberName(joined.memberId)).toBe(demo.name);
    expect(await userName("own-name-demo")).toBe(demo.name);
  });
});

describe("an administrator renaming somebody else", () => {
  it("changes that workspace's member row and never the account's name (D24)", async () => {
    await callAction(
      {
        pool: (await workerDb()).appPool,
        workspaceId: second.workspaceId,
        actor: { kind: "human", userId: OTHER_OWNER },
      },
      "people.updateMember",
      { memberId: second.memberId, name: "Sam As We Know Them" },
    );
    expect(await memberName(second.memberId)).toBe("Sam As We Know Them");
    expect(await userName(SAM)).toBe("Sam Original");
    expect(await memberName(first.memberId)).toBe("Sam Original");
  });

  it("is held to the same name rule", async () => {
    await expect(
      callAction(
        {
          pool: (await workerDb()).appPool,
          workspaceId: second.workspaceId,
          actor: { kind: "human", userId: OTHER_OWNER },
        },
        "people.updateMember",
        { memberId: second.memberId, name: "x".repeat(201) },
      ),
    ).rejects.toThrow("Use at most 200 characters.");
  });
});
