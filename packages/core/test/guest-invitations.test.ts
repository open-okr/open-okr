import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveOwnWorkspaceAccessLevel,
  resolveSubjectContext,
} from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { previewInvite } from "../src/invitations/preview.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Inviting a guest straight into one space (completeness review M-22,
 * TECHNICAL-PLAN §4.1).
 *
 * A guest could only be made by converting a member, so an outsider held the
 * whole workspace between being invited and being converted. What is proved
 * here is the state a guest invitation leaves: a `guest` member, no binding on
 * the workspace's own context (the same place `people.convertToGuest` leaves a
 * member), and `view` on the one space the invitation named, reached through
 * the guest's own group because no standard tier ever reaches a guest.
 */

const OWNER = "guest-owner";

let workspaceId: string;
let partnersId: string;
let internalId: string;

const as = async (userId: string) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
  };
};

async function createUser(id: string, email: string, name: string) {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, name, email],
  );
}

async function memberRow(userId: string) {
  const wb = await workerDb();
  const rows = await wb.admin.query<{ id: string; kind: string }>(
    "select id, kind from workspace_members where workspace_id = $1 and user_id = $2 and deleted_at is null",
    [workspaceId, userId],
  );
  return rows.rows[0];
}

/** A member's level on a space's own context, through the one resolver. */
async function levelOnSpace(memberId: string, spaceId: string) {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, async (tx) => {
    const context = await resolveSubjectContext(
      tx,
      "space",
      spaceId,
      workspaceId,
    );
    if (!context) {
      throw new Error("no space context");
    }
    return resolveMemberAccessLevel(tx, {
      workspaceId,
      memberId,
      contextId: context.contextId,
    });
  });
}

/** Somebody who joined through an ordinary reusable link. */
async function joinAsMember(userId: string) {
  await createUser(userId, `${userId}@example.com`, userId);
  const link = await callAction(
    await as(OWNER),
    "invitations.createWorkspaceLink",
    {},
  );
  await callAction(await as(userId), "invitations.acceptLink", {
    token: link.token,
  });
}

async function inviteGuest(email: string, spaceId: string) {
  return callAction(await as(OWNER), "invitations.createPersonalLink", {
    email,
    guestSpaceId: spaceId,
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await createUser(OWNER, "guest-owner@example.com", "Owner");
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  partnersId = (
    await callAction(await as(OWNER), "spaces.create", { name: "Partners" })
  ).id;
  internalId = (
    await callAction(await as(OWNER), "spaces.create", { name: "Internal" })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("issuing a guest invitation", () => {
  it("names one space, and the list says so", async () => {
    const link = await inviteGuest("ada@partner.example", partnersId);
    expect(link.memberKind).toBe("guest");
    expect(link.spaceId).toBe(partnersId);

    const listed = await callAction(await as(OWNER), "invitations.list", {});
    const row = listed.find((entry) => entry.id === link.id);
    expect(row?.memberKind).toBe("guest");
    expect(row?.spaceId).toBe(partnersId);
    expect(row?.email).toBe("ada@partner.example");
  });

  it("leaves an ordinary invitation a member's", async () => {
    const link = await callAction(
      await as(OWNER),
      "invitations.createPersonalLink",
      { email: "bo@example.com" },
    );
    expect(link.memberKind).toBe("human");
    expect(link.spaceId).toBeNull();
  });

  it("is refused to somebody without full access to the workspace", async () => {
    await joinAsMember("guest-plain-member");
    await expect(
      callAction(
        await as("guest-plain-member"),
        "invitations.createPersonalLink",
        { email: "ada@partner.example", guestSpaceId: partnersId },
      ),
    ).rejects.toThrow();

    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select count(*)::int as n from invite_links where member_kind = 'guest'",
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it("refuses a space that does not exist or was archived", async () => {
    await expect(
      inviteGuest(
        "ada@partner.example",
        "00000000-0000-4000-8000-000000000000",
      ),
    ).rejects.toThrow(/No such space/);

    await callAction(await as(OWNER), "spaces.archive", { id: internalId });
    await expect(
      inviteGuest("ada@partner.example", internalId),
    ).rejects.toThrow(/No such space/);
  });

  it("writes an audit row naming the space", async () => {
    const link = await inviteGuest("ada@partner.example", partnersId);
    const wb = await workerDb();
    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where action = 'invitations.createPersonalLink' and target_id = $1",
      [link.id],
    );
    expect(audit.rows[0]?.payload).toMatchObject({
      guest: true,
      spaceId: partnersId,
    });
  });
});

describe("accepting a guest invitation", () => {
  it("makes a guest who sees the named space and nothing on the workspace", async () => {
    const link = await inviteGuest("ada@partner.example", partnersId);
    await createUser("guest-ada", "ada@partner.example", "Ada Guest");

    const accepted = await callAction(
      await as("guest-ada"),
      "invitations.acceptLink",
      { token: link.token },
    );

    const member = await memberRow("guest-ada");
    expect(member?.id).toBe(accepted.memberId);
    expect(member?.kind).toBe("guest");

    const wb = await workerDb();
    // Nothing on the workspace's own context: the state convertToGuest leaves.
    expect(
      await resolveOwnWorkspaceAccessLevel(
        wb.appPool,
        workspaceId,
        accepted.memberId,
      ),
    ).toBe(0);
    // View on the one space, and nothing on the other.
    expect(await levelOnSpace(accepted.memberId, partnersId)).toBe(
      ACCESS_LEVELS.view,
    );
    expect(await levelOnSpace(accepted.memberId, internalId)).toBe(0);

    const partners = await callAction(await as("guest-ada"), "spaces.read", {
      id: partnersId,
    });
    expect(partners.members.map((row) => row.memberId)).toContain(
      accepted.memberId,
    );
    await expect(
      callAction(await as("guest-ada"), "spaces.read", { id: internalId }),
    ).rejects.toThrow(/No such space/);
  });

  it("lets the guest read what the space's home shows them", async () => {
    const link = await inviteGuest("ada@partner.example", partnersId);
    await createUser("guest-home", "ada@partner.example", "Home Guest");
    await callAction(await as("guest-home"), "invitations.acceptLink", {
      token: link.token,
    });
    const guest = await as("guest-home");

    // Every space-scoped read `spaces/[id]/page.tsx` makes, as the guest. One
    // refusing would take the page down for exactly the person this
    // invitation is for.
    await callAction(guest, "spaces.read", { id: partnersId });
    await callAction(guest, "activities.spaceFeed", { spaceId: partnersId });
    await callAction(guest, "people.directory", {});
    await callAction(guest, "subscriptions.read", {
      subjectType: "space",
      subjectId: partnersId,
    });
    await callAction(guest, "sessions.list", { spaceId: partnersId });
    await callAction(guest, "blockers.board", { spaceId: partnersId });
    await callAction(guest, "sessions.confidenceTrend", {
      spaceId: partnersId,
      weeks: 12,
    });
    await callAction(guest, "sessions.readStreak", { spaceId: partnersId });
    const goals = await callAction(guest, "goals.list", {
      spaceId: partnersId,
      includeClosed: false,
    });
    expect(goals.goals).toEqual([]);
    const kpis = await callAction(guest, "kpis.spaceTrees", {
      spaceId: partnersId,
    });
    expect(kpis.trees).toEqual([]);

    // The two workspace-wide reads refuse a guest, as not-found, because a
    // guest holds nothing on the workspace itself. The page reads that
    // refusal as "use the default" rather than failing.
    await expect(
      callAction(guest, "settings.readForMember", {}),
    ).rejects.toThrow(/No such workspace/);
    await expect(callAction(guest, "rhythm.read", {})).rejects.toThrow(
      /No such workspace/,
    );
  });

  it("is refused, and writes nobody, once the space is archived", async () => {
    const link = await inviteGuest("ada@partner.example", partnersId);
    await callAction(await as(OWNER), "spaces.archive", { id: partnersId });
    await createUser("guest-late", "ada@partner.example", "Late Guest");

    await expect(
      callAction(await as("guest-late"), "invitations.acceptLink", {
        token: link.token,
      }),
    ).rejects.toThrow(/no longer valid/);
    expect(await memberRow("guest-late")).toBeUndefined();
  });

  it("never demotes somebody who is already a member", async () => {
    await joinAsMember("guest-colleague");
    const colleague = await memberRow("guest-colleague");
    const link = await inviteGuest("guest-colleague@example.com", partnersId);

    await callAction(await as("guest-colleague"), "invitations.acceptLink", {
      token: link.token,
    });

    const after = await memberRow("guest-colleague");
    expect(after?.kind).toBe("human");
    const wb = await workerDb();
    expect(
      await resolveOwnWorkspaceAccessLevel(
        wb.appPool,
        workspaceId,
        colleague?.id ?? "",
      ),
    ).toBe(ACCESS_LEVELS.edit);
  });

  it("gives the space back when the guest is taken out of it", async () => {
    const link = await inviteGuest("ada@partner.example", partnersId);
    await createUser("guest-removed", "ada@partner.example", "Removed Guest");
    const { memberId } = await callAction(
      await as("guest-removed"),
      "invitations.acceptLink",
      { token: link.token },
    );

    await callAction(await as(OWNER), "spaces.removeMember", {
      spaceId: partnersId,
      memberId,
    });
    expect(await levelOnSpace(memberId, partnersId)).toBe(0);
    await expect(
      callAction(await as("guest-removed"), "spaces.read", { id: partnersId }),
    ).rejects.toThrow(/No such space/);
  });
});

describe("a guest put in a space by hand", () => {
  it("sees it, where before the space's standard group gave them nothing", async () => {
    await joinAsMember("guest-converted");
    const member = await memberRow("guest-converted");
    const memberId = member?.id ?? "";
    await callAction(await as(OWNER), "people.convertToGuest", { memberId });
    expect(await levelOnSpace(memberId, partnersId)).toBe(0);

    await callAction(await as(OWNER), "spaces.addMember", {
      spaceId: partnersId,
      memberId,
      role: "member",
    });
    expect(await levelOnSpace(memberId, partnersId)).toBe(ACCESS_LEVELS.view);
    expect(await levelOnSpace(memberId, internalId)).toBe(0);
  });
});

describe("the join page's preview", () => {
  it("names the space a guest is being invited to", async () => {
    const link = await inviteGuest("ada@partner.example", partnersId);
    const wb = await workerDb();
    const preview = await previewInvite(wb.appPool, {
      token: link.token,
      now: new Date(),
    });
    expect(preview.kind).toBe("usable");
    if (preview.kind === "usable") {
      expect(preview.guestSpaceName).toBe("Partners");
    }
  });

  it("refuses a guest invitation whose space was archived, as acceptance does", async () => {
    const link = await inviteGuest("ada@partner.example", partnersId);
    await callAction(await as(OWNER), "spaces.archive", { id: partnersId });
    const wb = await workerDb();
    const preview = await previewInvite(wb.appPool, {
      token: link.token,
      now: new Date(),
    });
    expect(preview.kind).toBe("refused");
  });
});
