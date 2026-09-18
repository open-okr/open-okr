import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { createAuth } from "../src/auth/auth.ts";
import { buildDemoWorkspace } from "../src/demo/builder.ts";
import { INVENTED_CAST } from "../src/demo/cast.ts";
import {
  DEMO_PERSONA_PASSWORD,
  prepareDemoPersonas,
} from "../src/demo/personas.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A visitor can sign in as one of the cast (P8-T13a).
 *
 * P3-T17 wrote "demo people cannot sign in. They are members with no user
 * account", which is right for a seed on somebody's laptop and wrong for a
 * public instance where the visitor is nobody. These tests are about the two
 * halves of fixing that: the accounts exist and are attached to the members
 * the builder already wrote, and the command refuses a workspace that is not
 * a demo.
 *
 * **Signing in is proved through Better Auth**, not by reading a row. An
 * account row with a password hash beside it proves nothing about whether the
 * credential works, and "the persona can sign in" is the whole deliverable.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const OWNER = "persona-owner";

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;
let workspaceId: string;

const context = async () => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Demo Owner", "persona-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Northwind Labs",
    })
  ).workspaceId;

  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    // Off, because several sign-ins below would otherwise trip the window
    // that is there to stop somebody guessing a password.
    rateLimit: { enabled: false },
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const prepare = async () => {
  const wb = await workerDb();
  return prepareDemoPersonas({
    pool: wb.appPool,
    workspaceId,
    adminUserId: OWNER,
    auth,
  });
};

describe("a workspace that is not a demo", () => {
  it("is refused, because the accounts are invented and the password is public", async () => {
    // Nothing is seeded yet, so this is a workspace somebody could have made
    // for real work. The guard fires before any account is created.
    await expect(prepare()).rejects.toBeInstanceOf(OperationError);
    const { rows } = await (await workerDb()).admin.query(
      "select count(*)::int as n from users where email like '%@northwind.example'",
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe("a seeded demo workspace", () => {
  beforeAll(async () => {
    const wb = await workerDb();
    await buildDemoWorkspace({
      pool: wb.appPool,
      workspaceId,
      adminUserId: OWNER,
    });
  });

  it("gives every invented person an account", async () => {
    const outcome = await prepare();

    expect(outcome.accountsCreated).toBe(INVENTED_CAST.length);
    expect(outcome.personas.map((one) => one.email).sort()).toEqual(
      INVENTED_CAST.map((one) => one.email).sort(),
    );
  });

  it("attaches the account to the member the builder already wrote", async () => {
    const wb = await workerDb();
    // One row, not two. A second Priya in the directory is the failure this
    // guards: the sign-up hook joins a workspace, and a persona has to be
    // attached instead.
    const { rows } = await wb.admin.query(
      `select m.id, m.user_id, u.email
         from workspace_members m
         join users u on u.id = m.user_id
        where m.workspace_id = $1 and m.name = 'Priya Raman'
          and m.deleted_at is null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("priya@northwind.example");
  });

  it("does not give a persona a private workspace of their own", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from workspaces where deleted_at is null",
    );
    // The one the owner registered, and nothing else. A persona who was
    // provisioned rather than attached would have brought a second.
    expect(rows[0]?.n).toBe(1);
  });

  it("lets a persona actually sign in, through Better Auth", async () => {
    const response = await auth.api.signInEmail({
      body: {
        email: "priya@northwind.example",
        password: DEMO_PERSONA_PASSWORD,
      },
      asResponse: true,
    });
    expect(response.status).toBe(200);
  });

  it("refuses a persona's account with the wrong password", async () => {
    // The password being published is not the same as there being none.
    const response = await auth.api.signInEmail({
      body: {
        email: "priya@northwind.example",
        password: "not-the-demo-password",
      },
      asResponse: true,
    });
    expect(response.status).toBe(401);
  });

  it("puts both agents in sandbox, which commits nothing", async () => {
    const agents = await callAction(await context(), "agents.list", {});
    expect(agents.length).toBeGreaterThanOrEqual(2);
    for (const agent of agents) {
      expect(agent.autonomy).toBe("sandbox");
    }
  });

  it("ran the Coach, so the nudges on screen cite rules rather than being rows", async () => {
    const wb = await workerDb();
    // Read from the table rather than through `nudges.list`, which answers for
    // the member asking: the Coach writes to the champion of each goal, and
    // most of those are personas rather than the owner running this.
    const { rows } = await wb.admin.query(
      `select rule_key from nudges
        where workspace_id = $1 and deleted_at is null`,
      [workspaceId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const nudge of rows) {
      expect(String(nudge.rule_key).length).toBeGreaterThan(0);
    }
  });

  it("changes nothing when it runs again", async () => {
    const again = await prepare();
    expect(again.accountsCreated).toBe(0);
    expect(again.personas).toHaveLength(INVENTED_CAST.length);

    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from users where email like '%@northwind.example'",
    );
    expect(rows[0]?.n).toBe(INVENTED_CAST.length);
  });
});
