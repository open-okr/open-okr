import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { grantOperator } from "../src/operator/grants.ts";
import { createWorkspaceAsOperator } from "../src/operator/workspaces.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { CLOUD_ENABLED_KEY, readTenant } from "../src/tenancy/index.ts";
import {
  createOwnWorkspace,
  mayCreateOwnWorkspace,
} from "../src/workspaces/create-own.ts";
import { listMembershipsForUser } from "../src/workspaces/memberships.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Creating a workspace after sign-up (docs/design/hosting-profiles.md §8).
 *
 * A workspace used to appear only at sign-up, so a group could not give each
 * company one, and a customer of a per-workspace cloud could not buy a second.
 */

const ring = parseKeyRing({ current: newRootKey() });

const FOUNDER = "create-founder";
const OPERATOR = "create-operator";
const OTHER = "create-other";
const FREE_PLANS = [
  { key: "free", name: "Free", seats: 10, aiMonthlyUsd: null },
  { key: "team", name: "Team", seats: 50, aiMonthlyUsd: null },
];

const seedUser = async (id: string, email = `${id}@company.example`) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, `Person ${id}`, email],
  );
};

const applySetup = async (settings: Record<string, unknown>) => {
  const wb = await workerDb();
  await writeSettings(
    wb.appPool,
    ring,
    Object.entries(settings).map(([key, value]) => ({ key, value })),
  );
};

const asOperator = async () => {
  const wb = await workerDb();
  await grantOperator(wb.appPool, {
    email: `${OPERATOR}@company.example`,
    grantedByEmail: `${FOUNDER}@company.example`,
  });
};

const ownerRoleOf = async (workspaceId: string, memberId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    `select r.builtin_key as key from workspace_members m
       join workspace_roles r on r.id = m.role_id
      where m.workspace_id = $1 and m.id = $2`,
    [workspaceId, memberId],
  );
  return rows[0]?.key;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  await Promise.all([seedUser(FOUNDER), seedUser(OPERATOR), seedUser(OTHER)]);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("an operator", () => {
  beforeEach(async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "registration.policy": "invite_only",
    });
    await asOperator();
  });

  it("names somebody with an account, who owns it straight away", async () => {
    const wb = await workerDb();
    const created = await createWorkspaceAsOperator(wb.appPool, {
      operatorUserId: OPERATOR,
      name: "Northwind Malaysia",
      ownerEmail: `${OTHER}@company.example`,
    });

    expect(created.ownerHadAccount).toBe(true);
    expect(created.name).toBe("Northwind Malaysia");
    await expect(
      ownerRoleOf(created.workspaceId, created.memberId),
    ).resolves.toBe("owner");
    const memberships = await listMembershipsForUser(wb.appPool, OTHER);
    expect(memberships.map((m) => m.workspaceId)).toContain(
      created.workspaceId,
    );
    await expect(
      readTenant(wb.appPool, created.workspaceId),
    ).resolves.toMatchObject({ state: "active" });
  });

  it("never becomes a member of what they create", async () => {
    const wb = await workerDb();
    const created = await createWorkspaceAsOperator(wb.appPool, {
      operatorUserId: OPERATOR,
      name: "Northwind Malaysia",
      ownerEmail: `${OTHER}@company.example`,
    });
    const memberships = await listMembershipsForUser(wb.appPool, OPERATOR);
    expect(memberships.map((m) => m.workspaceId)).not.toContain(
      created.workspaceId,
    );
  });

  it("names somebody with no account, who gets one invitation and then owns it", async () => {
    const wb = await workerDb();
    const created = await createWorkspaceAsOperator(wb.appPool, {
      operatorUserId: OPERATOR,
      name: "Northwind Malaysia",
      ownerEmail: "New.Owner@company.example",
    });
    expect(created.ownerHadAccount).toBe(false);

    const { rows: mail } = await wb.admin.query(
      "select payload from outbox where topic = 'invitation.email' and payload->>'workspaceId' = $1",
      [created.workspaceId],
    );
    expect(mail).toHaveLength(1);
    expect(mail[0].payload.to).toBe("new.owner@company.example");

    await seedUser("create-new-owner", "new.owner@company.example");
    const { memberId } = await callAction(
      {
        pool: wb.appPool,
        workspaceId: created.workspaceId,
        actor: { kind: "human", userId: "create-new-owner" },
      },
      "invitations.acceptLink",
      { token: mail[0].payload.token },
    );

    // The waiting row is claimed, not doubled, and keeps the owner's role.
    expect(memberId).toBe(created.memberId);
    await expect(ownerRoleOf(created.workspaceId, memberId)).resolves.toBe(
      "owner",
    );
    const { rows } = await wb.admin.query(
      "select name, kind, status, user_id from workspace_members where id = $1",
      [memberId],
    );
    expect(rows[0]).toEqual({
      name: "Person create-new-owner",
      kind: "human",
      status: "active",
      user_id: "create-new-owner",
    });
  });

  it("records it on the instance chain", async () => {
    const wb = await workerDb();
    await createWorkspaceAsOperator(wb.appPool, {
      operatorUserId: OPERATOR,
      name: "Northwind Malaysia",
      ownerEmail: `${OTHER}@company.example`,
    });
    const { rows } = await wb.admin.query(
      "select action from instance_audit_events where action = 'operator.workspace_created'",
    );
    expect(rows).toHaveLength(1);
  });

  it("is not-found for somebody with no grant", async () => {
    const wb = await workerDb();
    await expect(
      createWorkspaceAsOperator(wb.appPool, {
        operatorUserId: OTHER,
        name: "Sneaky",
        ownerEmail: `${OTHER}@company.example`,
      }),
    ).rejects.toThrow(/No such workspace/);
  });

  it("refuses a bad address before anything is written", async () => {
    const wb = await workerDb();
    await expect(
      createWorkspaceAsOperator(wb.appPool, {
        operatorUserId: OPERATOR,
        name: "Northwind",
        ownerEmail: "not an address",
      }),
    ).rejects.toThrow(/not an email address/);
  });
});

describe("a signed-in person", () => {
  const own = (userId = FOUNDER) =>
    workerDb().then((wb) =>
      createOwnWorkspace(wb.appPool, { userId, name: "Second" }, {}),
    );

  it("is refused under an invitation-only policy, by any surface", async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "registration.policy": "invite_only",
    });
    const wb = await workerDb();
    const first = await createWorkspace(wb.appPool, {
      user: { id: FOUNDER, name: "Founder" },
    });
    await expect(own()).rejects.toThrow(/created by whoever runs it/);
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId: first.workspaceId,
          actor: { kind: "human", userId: FOUNDER },
        },
        "workspace.provision",
        { name: "Second" },
      ),
    ).rejects.toThrow(/created by whoever runs it/);
    const memberships = await listMembershipsForUser(wb.appPool, FOUNDER);
    expect(memberships).toHaveLength(1);
  });

  it("is refused on a self-hosted instance, whose first account closed the door", async () => {
    await expect(own()).rejects.toThrow(/created by whoever runs it/);
  });

  it("may start one where sign-up is open, through the action as well", async () => {
    await applySetup({ [CLOUD_ENABLED_KEY]: true });
    const wb = await workerDb();
    const first = await createWorkspace(wb.appPool, {
      user: { id: FOUNDER, name: "Founder" },
    });
    const second = await callAction(
      {
        pool: wb.appPool,
        workspaceId: first.workspaceId,
        actor: { kind: "human", userId: FOUNDER },
      },
      "workspace.provision",
      { name: "Second" },
    );
    await expect(
      ownerRoleOf(second.workspaceId, second.memberId),
    ).resolves.toBe("owner");
  });

  it("cannot make one for somebody else", async () => {
    await applySetup({ [CLOUD_ENABLED_KEY]: true });
    const wb = await workerDb();
    const first = await createWorkspace(wb.appPool, {
      user: { id: FOUNDER, name: "Founder" },
    });
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId: first.workspaceId,
          actor: { kind: "human", userId: FOUNDER },
        },
        "workspace.provision",
        { name: "Theirs", user: { id: OTHER, name: "Other" } },
      ),
    ).rejects.toThrow(/for somebody else/);
  });

  it("is judged by address under a company-address policy", async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "registration.policy": "company_domains",
    });
    const wb = await workerDb();
    await expect(
      mayCreateOwnWorkspace(wb.appPool, "me@company.example", {}),
    ).resolves.toBe(true);
    await expect(
      mayCreateOwnWorkspace(wb.appPool, "me@gmail.com", {}),
    ).resolves.toBe(false);
  });

  it("may own one free workspace, and is told the limit past it", async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "cloud.plans": FREE_PLANS,
      "cloud.defaultPlan": "free",
    });
    const wb = await workerDb();
    await createWorkspace(wb.appPool, {
      user: { id: FOUNDER, name: "Founder" },
    });
    await expect(own()).rejects.toThrow(/1 free workspace/);
    await expect(own(OTHER)).resolves.toMatchObject({ name: "Second" });
  });

  it("does not count a workspace on a paid plan, or one they only belong to", async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "cloud.plans": FREE_PLANS,
      "cloud.defaultPlan": "free",
    });
    const wb = await workerDb();
    const first = await createWorkspace(wb.appPool, {
      user: { id: FOUNDER, name: "Founder" },
    });
    await wb.admin.query(
      "update tenants set plan_key = 'team', seats = 50 where workspace_id = $1",
      [first.workspaceId],
    );
    await expect(own()).resolves.toMatchObject({ name: "Second" });
  });

  it("is limited by the setting, and zero means unlimited", async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "cloud.plans": FREE_PLANS,
      "cloud.defaultPlan": "free",
      "cloud.limits.freeWorkspacesPerPerson": 0,
    });
    const wb = await workerDb();
    await createWorkspace(wb.appPool, {
      user: { id: FOUNDER, name: "Founder" },
    });
    await expect(own()).resolves.toMatchObject({ name: "Second" });
  });

  it("is not limited with no default plan, so a group never is", async () => {
    await applySetup({ [CLOUD_ENABLED_KEY]: true });
    const wb = await workerDb();
    await createWorkspace(wb.appPool, {
      user: { id: FOUNDER, name: "Founder" },
    });
    await expect(own()).resolves.toMatchObject({ name: "Second" });
    await expect(own()).resolves.toMatchObject({ name: "Second" });
  });

  it("an operator is not held to the free limit", async () => {
    await applySetup({
      [CLOUD_ENABLED_KEY]: true,
      "cloud.plans": FREE_PLANS,
      "cloud.defaultPlan": "free",
    });
    await asOperator();
    const wb = await workerDb();
    await createWorkspace(wb.appPool, { user: { id: OTHER, name: "Other" } });
    await expect(
      createWorkspaceAsOperator(wb.appPool, {
        operatorUserId: OPERATOR,
        name: "Another",
        ownerEmail: `${OTHER}@company.example`,
      }),
    ).resolves.toMatchObject({ name: "Another" });
  });
});
