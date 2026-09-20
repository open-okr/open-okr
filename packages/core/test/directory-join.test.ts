import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { providerIdFromCallback } from "../src/auth/sso.ts";
import { joinWorkspaceForIdentity } from "../src/workspaces/directory-join.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Landing in the workspace that vouched for you (P8-T07b).
 *
 * P8-T07's deliverable says just-in-time provisioning lands in the one member
 * funnel. It landed in `provisionWorkspaceForUser` instead, which gives a
 * person with no membership anywhere a fresh workspace of their own, so the
 * first employee to sign in through their company's provider arrived alone in
 * an empty workspace and never saw the one that had configured it.
 */

let workspaceId: string;

async function user(id: string, email: string): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
     values ($1, $2, $3, true, now(), now())
     on conflict (id) do nothing`,
    [id, id, email],
  );
}

beforeAll(async () => {
  const wb = await workerDb();
  await user("join-owner", "join-owner@acme.test");
  await user("join-arrival", "arrival@acme.test");
  await user("join-second", "second@acme.test");

  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "join-owner",
      name: "Acme",
    })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the provider id out of a callback", () => {
  it("is read from the route parameters when they carry it", () => {
    expect(
      providerIdFromCallback("/callback/sso-okta-abc12345", {
        id: "sso-okta-abc12345",
      }),
    ).toBe("sso-okta-abc12345");
  });

  it("falls back to the path when they do not", () => {
    expect(
      providerIdFromCallback("/callback/sso-okta-abc12345", undefined),
    ).toBe("sso-okta-abc12345");
    expect(providerIdFromCallback("/callback/sso-okta-abc12345", {})).toBe(
      "sso-okta-abc12345",
    );
  });

  it("answers nothing for anything that is not a callback", () => {
    expect(providerIdFromCallback("/sign-in/email", { id: "x" })).toBe("");
    expect(providerIdFromCallback(undefined, { id: "x" })).toBe("");
    expect(providerIdFromCallback("/evil/callback/x", undefined)).toBe("");
  });
});

describe("joining the workspace that vouched for somebody", () => {
  it("makes them a member of it, not of a new one", async () => {
    const wb = await workerDb();

    const joined = await joinWorkspaceForIdentity(wb.appPool, {
      workspaceId,
      user: { id: "join-arrival", name: "Arrival" },
      via: "sso",
    });
    expect(joined.created).toBe(true);

    const { rows } = await wb.admin.query(
      `select workspace_id, status from workspace_members
        where user_id = 'join-arrival' and deleted_at is null`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBe(workspaceId);
    expect(rows[0]?.status).toBe("active");
  });

  it("leaves the later provisioning call a no-op", async () => {
    const wb = await workerDb();

    // What the after-create hook does next. It must find the membership
    // rather than hand them a workspace of their own.
    const provisioned = await provisionWorkspaceForUser(wb.appPool, {
      id: "join-arrival",
      name: "Arrival",
    });
    expect(provisioned.workspaceId).toBe(workspaceId);

    const { rows } = await wb.admin.query(
      "select id from workspaces where deleted_at is null",
    );
    // The owner's workspace and nothing else: no empty second one.
    expect(rows).toHaveLength(1);
  });

  it("is idempotent, and says which call actually added somebody", async () => {
    const wb = await workerDb();

    const first = await joinWorkspaceForIdentity(wb.appPool, {
      workspaceId,
      user: { id: "join-second", name: "Second" },
      via: "directory_sync",
      externalId: "okta-0002",
    });
    const again = await joinWorkspaceForIdentity(wb.appPool, {
      workspaceId,
      user: { id: "join-second", name: "Second" },
      via: "directory_sync",
      externalId: "okta-0002",
    });

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.memberId).toBe(first.memberId);

    const { rows } = await wb.admin.query(
      `select id from workspace_members
        where user_id = 'join-second' and deleted_at is null`,
    );
    expect(rows).toHaveLength(1);
  });

  it("writes one audit row per call and one activity row per arrival", async () => {
    const wb = await workerDb();

    const audits = await wb.admin.query(
      `select payload from audit_events
        where action = 'workspace.directoryJoin'
          and workspace_id = $1
        order by at`,
      [workspaceId],
    );
    // Two arrivals. The repeat call answers from the membership it finds
    // and never opens an Operation, so it writes nothing at all.
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows.map((r) => (r.payload as { via: string }).via)).toEqual([
      "sso",
      "directory_sync",
    ]);
    const directoryPayload = audits.rows[1]?.payload as
      | { externalId?: string }
      | undefined;
    expect(directoryPayload?.externalId).toBe("okta-0002");

    const activities = await wb.admin.query(
      `select payload from activities
        where kind = 'member.joined_by_directory'
          and workspace_id = $1`,
      [workspaceId],
    );
    // Two people arrived. The repeat call is a reconciliation, not an event.
    expect(activities.rows).toHaveLength(2);
  });
});
