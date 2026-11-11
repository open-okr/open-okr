import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { timezoneForAccount } from "../src/workspaces/memberships.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The timezone an account-level mail tells its time in (UAT 0.8.0 Q-7).
 *
 * An account belongs to no workspace, so the answer is the person's own
 * timezone in their first workspace, then that workspace's, then UTC.
 */

const PERSON = "account-timezone-person";

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Amara', 'amara@example.com')",
    [PERSON],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

const provision = async () => {
  const wb = await workerDb();
  return (
    await provisionWorkspaceForUser(wb.appPool, { id: PERSON, name: "Amara" })
  ).workspaceId;
};

describe("an account's timezone", () => {
  it("is the person's own, set on their membership", async () => {
    const wb = await workerDb();
    const workspaceId = await provision();
    await wb.admin.query(
      "update workspace_members set timezone = 'Asia/Kuala_Lumpur' where workspace_id = $1 and user_id = $2",
      [workspaceId, PERSON],
    );
    expect(await timezoneForAccount(wb.appPool, PERSON)).toBe(
      "Asia/Kuala_Lumpur",
    );
  });

  it("is the workspace's when the person set none", async () => {
    const wb = await workerDb();
    const workspaceId = await provision();
    await wb.admin.query(
      "update workspace_members set timezone = null where workspace_id = $1",
      [workspaceId],
    );
    await wb.admin.query(
      `update workspaces set settings = settings || '{"timezone": "Europe/Lisbon"}'::jsonb where id = $1`,
      [workspaceId],
    );
    expect(await timezoneForAccount(wb.appPool, PERSON)).toBe("Europe/Lisbon");
  });

  it("is UTC for an account in no workspace, or with a zone nobody knows", async () => {
    const wb = await workerDb();
    expect(await timezoneForAccount(wb.appPool, PERSON)).toBe("UTC");
    const workspaceId = await provision();
    await wb.admin.query(
      "update workspace_members set timezone = 'Mars/Olympus_Mons' where workspace_id = $1",
      [workspaceId],
    );
    await wb.admin.query(
      `update workspaces set settings = settings - 'timezone' where id = $1`,
      [workspaceId],
    );
    expect(await timezoneForAccount(wb.appPool, PERSON)).toBe("UTC");
  });
});
