import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveOwnWorkspaceAccessLevel } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Handing over administration (completeness review H-14).
 *
 * Nothing could change a member's workspace access: provisioning made the
 * founder `full`, invitations granted `edit` at most, and the profile page told
 * a sole administrator to hand over first with no way to do it.
 */

const FOUNDER = "handover-founder";
const JOINER = "handover-joiner";

let workspaceId: string;
let founderMemberId: string;
let joinerMemberId: string;

const as = async (userId: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const levelOf = async (memberId: string) =>
  resolveOwnWorkspaceAccessLevel(
    (await workerDb()).appPool,
    workspaceId,
    memberId,
  );

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [
      FOUNDER,
      "handover-founder@example.com",
      JOINER,
      "handover-joiner@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FOUNDER,
    name: "Founder",
  });
  workspaceId = provisioned.workspaceId;
  founderMemberId = provisioned.memberId;
  // Joined through an invitation, the way every second member arrives.
  joinerMemberId = (
    await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      provisionMemberForInvite(tx, {
        workspaceId,
        user: { id: JOINER, name: "Joiner" },
      }),
    )
  ).memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("handing over administration", () => {
  it("makes a member an administrator, and lets the founder then step down", async () => {
    expect(await levelOf(joinerMemberId)).toBe(ACCESS_LEVELS.edit);

    await callAction(await as(FOUNDER), "people.setAdministrator", {
      memberId: joinerMemberId,
      administrator: true,
    });
    expect(await levelOf(joinerMemberId)).toBe(ACCESS_LEVELS.full);

    await callAction(await as(FOUNDER), "people.setAdministrator", {
      memberId: founderMemberId,
      administrator: false,
    });
    // Back to the standard level every member holds, not to nothing.
    expect(await levelOf(founderMemberId)).toBe(ACCESS_LEVELS.edit);
    expect(await levelOf(joinerMemberId)).toBe(ACCESS_LEVELS.full);
  });

  it("refuses to let the last administrator step down", async () => {
    await expect(
      callAction(await as(FOUNDER), "people.setAdministrator", {
        memberId: founderMemberId,
        administrator: false,
      }),
    ).rejects.toThrow(/only member with full access/);
    expect(await levelOf(founderMemberId)).toBe(ACCESS_LEVELS.full);
  });

  it("never makes an agent or a guest an administrator", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ member_id: string }>(
      "select member_id from agents where workspace_id = $1 limit 1",
      [workspaceId],
    );
    await expect(
      callAction(await as(FOUNDER), "people.setAdministrator", {
        memberId: rows[0]?.member_id as string,
        administrator: true,
      }),
    ).rejects.toThrow(/agent never holds workspace-wide access/);

    await callAction(await as(FOUNDER), "people.convertToGuest", {
      memberId: joinerMemberId,
    });
    await expect(
      callAction(await as(FOUNDER), "people.setAdministrator", {
        memberId: joinerMemberId,
        administrator: true,
      }),
    ).rejects.toThrow(/guest cannot administer/);
  });

  it("is an administrator's decision, not anybody's", async () => {
    await expect(
      callAction(await as(JOINER), "people.setAdministrator", {
        memberId: joinerMemberId,
        administrator: true,
      }),
    ).rejects.toThrow();
    expect(await levelOf(joinerMemberId)).toBe(ACCESS_LEVELS.edit);
  });

  it("records who was made an administrator", async () => {
    const wb = await workerDb();
    await callAction(await as(FOUNDER), "people.setAdministrator", {
      memberId: joinerMemberId,
      administrator: true,
    });
    const { rows } = await wb.admin.query<{ action: string }>(
      "select action from audit_events where workspace_id = $1 and action = 'people.setAdministrator'",
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
  });
});
