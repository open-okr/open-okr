import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The invite step's list (docs/design/flowyteam-connect.md Q6, AC 9, card C5).
 *
 * Only people a FlowyTeam import wrote and nobody has claimed, each marked
 * when an open personal invitation to their address already exists.
 */

const OWNER = "flowyteam-people-owner";
const STRANGER = "flowyteam-people-stranger";

let workspaceId: string;
let otherWorkspaceId: string;

async function people(ws: string, userId: string) {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId: ws, actor: { kind: "human", userId } },
    "imports.flowyteamPeople",
    {},
  );
}

async function placeholder(
  ws: string,
  name: string,
  email: string,
  legacyType: "flowyteam" | "csv" = "flowyteam",
) {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into workspace_members
       (id, workspace_id, user_id, name, status, kind, placeholder_email, legacy_type, legacy_id)
     values (gen_random_uuid(), $1, null, $2, 'active', 'placeholder', $3, $4, $5)`,
    [ws, name, email, legacyType, `users:${email}`],
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', 'owner@example.com'), ($2, 'Stranger', 'stranger@example.com')",
    [OWNER, STRANGER],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  otherWorkspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: STRANGER,
      name: "Stranger",
    })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("imports.flowyteamPeople", () => {
  it("lists unclaimed FlowyTeam people only, by name, with their invitation state", async () => {
    await placeholder(workspaceId, "Rina", "Rina@Example.com");
    await placeholder(workspaceId, "Budi", "budi@example.com");
    await placeholder(workspaceId, "From a sheet", "sheet@example.com", "csv");
    await placeholder(otherWorkspaceId, "Elsewhere", "else@example.com");

    const wb = await workerDb();
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "invitations.createPersonalLink",
      { email: "budi@example.com" },
    );

    const answer = await people(workspaceId, OWNER);
    expect(answer.people.map((p) => [p.name, p.email, p.invited])).toEqual([
      ["Budi", "budi@example.com", true],
      ["Rina", "rina@example.com", false],
    ]);
  });

  it("is empty for a workspace nothing was imported into", async () => {
    const answer = await people(workspaceId, OWNER);
    expect(answer.people).toEqual([]);
  });
});
