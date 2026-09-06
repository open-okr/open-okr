import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { SETTINGS_REGISTRY } from "../src/settings/registry.ts";
import { listMembershipsForUser } from "../src/workspaces/memberships.ts";
import {
  createWorkspace,
  provisionWorkspaceForUser,
} from "../src/workspaces/provisioning.ts";
import { isRegistrationOpen } from "../src/workspaces/registration.ts";

/**
 * Workspace bootstrap (P1-T06 test plan, TECHNICAL-PLAN §4.1 and §4.14).
 *
 * The acceptance criterion in one line: a fresh instance, one registration,
 * and the person lands in a complete working workspace without answering a
 * single question. Everything here is driven through the real sign-up
 * endpoint rather than by inserting rows, because the provisioning hook is
 * part of what is being tested.
 */

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PASSWORD = "correct horse battery staple";

const register = (email: string, name: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the first registration provisions a workspace", () => {
  it("creates a workspace with the registering person as an active member", async () => {
    const response = await register("ada@example.com", "Ada Lovelace");
    expect(response.status).toBe(200);

    const wb = await workerDb();
    const workspaces = await wb.admin.query(
      "select id, name, slug, state, settings from workspaces",
    );
    expect(workspaces.rows).toHaveLength(1);
    expect(workspaces.rows[0].state).toBe("active");
    expect(workspaces.rows[0].name).toContain("Ada Lovelace");
    expect(workspaces.rows[0].slug).toMatch(/^[a-z0-9-]+$/);

    // Scoped to the human. The workspace also holds the seeded Champion
    // (P4-T05a), which is a member like anyone else and would otherwise make
    // this assertion about how many agents ship rather than about the person
    // who registered.
    const members = await wb.admin.query(
      "select name, kind, status, primary_channel, quiet_hours from workspace_members where kind = 'human'",
    );
    expect(members.rows).toHaveLength(1);
    expect(members.rows[0].name).toBe("Ada Lovelace");
    expect(members.rows[0].kind).toBe("human");
    expect(members.rows[0].status).toBe("active");
  });

  it("resolves every setting in the registry to its default, none null", async () => {
    await register("ada@example.com", "Ada Lovelace");

    const wb = await workerDb();
    const workspace = await wb.admin.query("select settings from workspaces");
    const member = await wb.admin.query(
      "select primary_channel, quiet_hours from workspace_members",
    );

    const settings = workspace.rows[0].settings as Record<string, unknown>;
    for (const setting of SETTINGS_REGISTRY.filter(
      (entry) => entry.scope === "workspace",
    )) {
      expect(
        settings[setting.key],
        `workspace setting ${setting.key} is missing`,
      ).not.toBeNull();
      expect(
        settings[setting.key],
        `workspace setting ${setting.key} is missing`,
      ).toBeDefined();
    }

    expect(member.rows[0].primary_channel).not.toBeNull();
    expect(member.rows[0].quiet_hours).not.toBeNull();
  });

  it("commits the workspace and the member together or not at all", async () => {
    const wb = await workerDb();
    await register("ada@example.com", "Ada Lovelace");

    // Three members, not one: the registering person and both seeded agents,
    // the Champion (P4-T05a) and the Coach (P4-T06a), all in the same
    // transaction. The property under test is still atomicity, so every half
    // is counted rather than the total being loosened to "at least one".
    const counts = await wb.admin.query(
      `select (select count(*) from workspaces)::int as w,
              (select count(*) from workspace_members where kind = 'human')::int as humans,
              (select count(*) from workspace_members where kind = 'agent')::int as agents`,
    );
    expect(counts.rows[0]).toEqual({ w: 1, humans: 1, agents: 2 });
  });
});

describe("the registration policy", () => {
  it("is open on an empty instance", async () => {
    const wb = await workerDb();
    expect(await isRegistrationOpen(wb.appPool)).toBe(true);
  });

  it("closes once somebody has registered", async () => {
    const wb = await workerDb();
    await register("ada@example.com", "Ada Lovelace");
    expect(await isRegistrationOpen(wb.appPool)).toBe(false);
  });

  it("refuses a second registration, and creates nothing", async () => {
    await register("ada@example.com", "Ada Lovelace");
    const second = await register("grace@example.com", "Grace Hopper");

    expect(second.status).toBeGreaterThanOrEqual(400);

    const wb = await workerDb();
    const users = await wb.admin.query("select count(*)::int as n from users");
    expect(users.rows[0].n).toBe(1);
    const workspaces = await wb.admin.query(
      "select count(*)::int as n from workspaces",
    );
    expect(workspaces.rows[0].n).toBe(1);
  });

  it("says why, so the sign-up screen can explain itself", async () => {
    await register("ada@example.com", "Ada Lovelace");
    const second = await register("grace@example.com", "Grace Hopper");
    const body = await second.text();
    expect(body.toLowerCase()).toMatch(/invit|closed/);
  });
});

describe("provisioning is idempotent", () => {
  it("does not create a second workspace for a user who already has one", async () => {
    const wb = await workerDb();
    await register("ada@example.com", "Ada Lovelace");

    const user = await wb.admin.query("select id, name from users");
    const userId = user.rows[0].id as string;

    const again = await provisionWorkspaceForUser(wb.appPool, {
      id: userId,
      name: user.rows[0].name as string,
    });

    const workspaces = await wb.admin.query("select id from workspaces");
    expect(workspaces.rows).toHaveLength(1);
    expect(again.workspaceId).toBe(workspaces.rows[0].id);
  });

  it("provisions a user who somehow has none, which is the repair path", async () => {
    // Better Auth runs the after-create hook once the transaction has already
    // committed, so a failure there leaves a real user with no workspace. This
    // is that state, and the repair that clears it.
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ('orphan', 'Orphan', 'orphan@example.com')",
    );

    expect(await listMembershipsForUser(wb.appPool, "orphan")).toEqual([]);

    const provisioned = await provisionWorkspaceForUser(wb.appPool, {
      id: "orphan",
      name: "Orphan",
    });
    expect(provisioned.workspaceId).toBeTruthy();

    const memberships = await listMembershipsForUser(wb.appPool, "orphan");
    expect(memberships).toHaveLength(1);
  });

  it("survives two concurrent provisions of the same user", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ('racer', 'Racer', 'racer@example.com')",
    );

    const both = await Promise.all([
      provisionWorkspaceForUser(wb.appPool, { id: "racer", name: "Racer" }),
      provisionWorkspaceForUser(wb.appPool, { id: "racer", name: "Racer" }),
    ]);

    expect(both[0]?.workspaceId).toBe(both[1]?.workspaceId);
    const workspaces = await wb.admin.query(
      "select count(*)::int as n from workspaces",
    );
    expect(workspaces.rows[0].n).toBe(1);
  });
});

describe("one user, several workspaces", () => {
  it("gives the same user a distinct member row in each", async () => {
    const wb = await workerDb();
    await register("ada@example.com", "Ada Lovelace");
    const user = await wb.admin.query("select id from users");
    const userId = user.rows[0].id as string;

    const second = await createWorkspace(wb.appPool, {
      user: { id: userId, name: "Ada Lovelace" },
      name: "Second workspace",
    });

    const memberships = await listMembershipsForUser(wb.appPool, userId);
    expect(memberships).toHaveLength(2);
    expect(new Set(memberships.map((m) => m.memberId)).size).toBe(2);
    expect(memberships.map((m) => m.workspaceId)).toContain(second.workspaceId);
  });

  it("keeps the two workspaces isolated from each other", async () => {
    const wb = await workerDb();
    await register("ada@example.com", "Ada Lovelace");
    const user = await wb.admin.query("select id from users");
    const userId = user.rows[0].id as string;

    await createWorkspace(wb.appPool, {
      user: { id: userId, name: "Ada Lovelace" },
      name: "Second workspace",
    });

    const memberships = await listMembershipsForUser(wb.appPool, userId);
    expect(memberships).toHaveLength(2);

    // Scoped to either workspace, the application role sees that workspace's
    // single member and nothing from the other one.
    for (const membership of memberships) {
      const client = await wb.appPool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.workspace_id', $1, true)", [
          membership.workspaceId,
        ]);
        const rows = await client.query<{ workspace_id: string }>(
          "select workspace_id from workspace_members",
        );
        // The member and the workspace's own two agents (P4-T05a, P4-T06a).
        // What this test is about is that neither workspace can see the
        // other's rows, so every row is checked rather than the count being
        // the assertion.
        expect(rows.rows).toHaveLength(3);
        for (const row of rows.rows) {
          expect(row.workspace_id).toBe(membership.workspaceId);
        }
        await client.query("commit");
      } finally {
        client.release();
      }
    }
  });

  it("gives each workspace its own slug", async () => {
    const wb = await workerDb();
    await register("ada@example.com", "Ada Lovelace");
    const user = await wb.admin.query("select id from users");
    const userId = user.rows[0].id as string;

    // The same name twice: the slug has to stay unique without the caller
    // being able to read other workspaces to check.
    await createWorkspace(wb.appPool, {
      user: { id: userId, name: "Ada Lovelace" },
      name: "Ada Lovelace's workspace",
    });

    const slugs = await wb.admin.query("select slug from workspaces");
    expect(new Set(slugs.rows.map((row) => row.slug)).size).toBe(
      slugs.rows.length,
    );
  });
});

describe("workspace naming", () => {
  it("names the workspace after the person, editable immediately", async () => {
    await register("ada@example.com", "Ada Lovelace");
    const wb = await workerDb();
    const workspace = await wb.admin.query("select name, slug from workspaces");
    expect(workspace.rows[0].name).toBe("Ada Lovelace's workspace");
    expect(workspace.rows[0].slug).toBe("ada-lovelaces-workspace");
  });

  it("still produces a usable slug when the name has no Latin letters", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ('kanji', '日本語', 'kanji@example.com')",
    );
    const provisioned = await provisionWorkspaceForUser(wb.appPool, {
      id: "kanji",
      name: "日本語",
    });
    expect(provisioned.slug).toMatch(/^[a-z0-9-]+$/);
    expect(provisioned.slug.length).toBeGreaterThan(0);
  });
});

describe("the workspace language default (P2-T08)", () => {
  const ENV_KEY = "OPENOKR_DEFAULT_LANGUAGE";
  const previous = process.env[ENV_KEY];

  afterAll(() => {
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
  });

  it("falls back to the registry constant with no instance setting or environment", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ('lang-plain', 'Plain', 'lang-plain@example.com')",
    );
    const provisioned = await createWorkspace(wb.appPool, {
      user: { id: "lang-plain", name: "Plain" },
    });
    const workspace = await wb.admin.query(
      "select settings from workspaces where id = $1",
      [provisioned.workspaceId],
    );
    expect((workspace.rows[0].settings as { language: string }).language).toBe(
      "en",
    );
  });

  it("lets OPENOKR_DEFAULT_LANGUAGE override the constant, the same as every other instance setting", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ('lang-env', 'Env', 'lang-env@example.com')",
    );
    process.env[ENV_KEY] = "ms";
    try {
      const provisioned = await createWorkspace(wb.appPool, {
        user: { id: "lang-env", name: "Env" },
      });
      const workspace = await wb.admin.query(
        "select settings from workspaces where id = $1",
        [provisioned.workspaceId],
      );
      expect(
        (workspace.rows[0].settings as { language: string }).language,
      ).toBe("ms");
    } finally {
      delete process.env[ENV_KEY];
    }
  });

  it("still lets an explicit caller-supplied language win over the environment", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ('lang-explicit', 'Explicit', 'lang-explicit@example.com')",
    );
    process.env[ENV_KEY] = "ms";
    try {
      const provisioned = await createWorkspace(wb.appPool, {
        user: { id: "lang-explicit", name: "Explicit" },
        language: "fr",
      });
      const workspace = await wb.admin.query(
        "select settings from workspaces where id = $1",
        [provisioned.workspaceId],
      );
      expect(
        (workspace.rows[0].settings as { language: string }).language,
      ).toBe("fr");
    } finally {
      delete process.env[ENV_KEY];
    }
  });
});
