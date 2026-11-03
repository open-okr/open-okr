import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import {
  COMPANY_EMAIL_MESSAGE,
  readRegistrationPolicy,
  registrationRefusal,
  setRegistrationPolicy,
} from "../src/workspaces/registration.ts";

/**
 * The registration policy set in the application (docs/design/
 * registration-policy.md §3 and §5). Each case here is a row of that table or
 * one of its acceptance criteria.
 */

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PASSWORD = "correct horse battery staple";
const ring = parseKeyRing({ current: newRootKey() });
const NO_VARIABLE = {};

const register = (email: string, name: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );

/** Claims the instance, so `auto` reads as closed from here on. */
async function claim() {
  const response = await register("owner@founder.example", "Owner");
  expect(response.status).toBe(200);
  const wb = await workerDb();
  const row = await wb.admin.query<{ user_id: string; workspace_id: string }>(
    "select user_id, workspace_id from workspace_members limit 1",
  );
  const first = row.rows[0];
  if (!first) {
    throw new Error("The claim made no member.");
  }
  return { userId: first.user_id, workspaceId: first.workspace_id };
}

async function usersCalled(email: string): Promise<number> {
  const wb = await workerDb();
  const rows = await wb.admin.query<{ n: number }>(
    "select count(*)::int as n from users where email = $1",
    [email],
  );
  return rows.rows[0]?.n ?? 0;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("truncate table instance_audit_events");
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

describe("reading the policy", () => {
  it("is invitation only on a claimed instance with nothing stored, and says it is the default", async () => {
    const wb = await workerDb();
    await claim();
    const read = await readRegistrationPolicy(wb.appPool, NO_VARIABLE);
    expect(read).toEqual({ value: "invite_only", source: "default" });
  });

  it("follows OPENOKR_REGISTRATION when nothing is stored", async () => {
    const wb = await workerDb();
    await claim();
    const read = await readRegistrationPolicy(wb.appPool, {
      OPENOKR_REGISTRATION: "open",
    });
    expect(read).toEqual({ value: "open", source: "environment" });
  });

  it("prefers a value saved in the application over the variable", async () => {
    const wb = await workerDb();
    const owner = await claim();
    await setRegistrationPolicy(wb.appPool, ring, {
      policy: "company_domains",
      ...owner,
    });
    const read = await readRegistrationPolicy(wb.appPool, {
      OPENOKR_REGISTRATION: "open",
    });
    expect(read).toEqual({ value: "company_domains", source: "database" });
  });
});

describe("saving the policy", () => {
  it("stores it and writes one instance audit event naming who", async () => {
    const wb = await workerDb();
    const owner = await claim();
    const outcome = await setRegistrationPolicy(wb.appPool, ring, {
      policy: "company_domains",
      ...owner,
    });
    expect(outcome).toBe("changed");

    const events = await wb.admin.query<{
      action: string;
      payload: Record<string, unknown>;
    }>("select action, payload from instance_audit_events");
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.action).toBe("instance.registration_changed");
    expect(events.rows[0]?.payload).toMatchObject({
      from: "invite_only",
      to: "company_domains",
      userId: owner.userId,
      workspaceId: owner.workspaceId,
    });
  });

  it("writes nothing when the choice is what is already in force", async () => {
    const wb = await workerDb();
    const owner = await claim();
    const outcome = await setRegistrationPolicy(wb.appPool, ring, {
      policy: "invite_only",
      ...owner,
    });
    expect(outcome).toBe("unchanged");
    const events = await wb.admin.query("select 1 from instance_audit_events");
    expect(events.rows).toHaveLength(0);
  });
});

describe("company email addresses (§3)", () => {
  beforeEach(async () => {
    const wb = await workerDb();
    const owner = await claim();
    await setRegistrationPolicy(wb.appPool, ring, {
      policy: "company_domains",
      ...owner,
    });
  });

  it("admits a company address, which gets a workspace of its own", async () => {
    const response = await register("ana@acme.example", "Ana");
    expect(response.status).toBe(200);
    const wb = await workerDb();
    const own = await wb.admin.query<{ n: number }>(
      `select count(*)::int as n from workspace_members wm
         join users u on u.id = wm.user_id where u.email = 'ana@acme.example'`,
    );
    expect(own.rows[0]?.n).toBe(1);
  });

  it("refuses a free mail address, creates nothing and says why", async () => {
    const response = await register("ana@gmail.com", "Ana");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).toContain(COMPANY_EMAIL_MESSAGE);
    expect(await usersCalled("ana@gmail.com")).toBe(0);
  });

  it("lets the sign-up form show, because the address is not known yet", async () => {
    const wb = await workerDb();
    expect(await registrationRefusal(wb.appPool, null)).toBeNull();
  });
});

describe("invitation only and anyone (§3)", () => {
  it("refuses a company address with no invitation under invitation only", async () => {
    const wb = await workerDb();
    const owner = await claim();
    await setRegistrationPolicy(wb.appPool, ring, {
      policy: "invite_only",
      ...owner,
    });
    const response = await register("ana@acme.example", "Ana");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await usersCalled("ana@acme.example")).toBe(0);
  });

  it("admits a free mail address under anyone", async () => {
    const wb = await workerDb();
    const owner = await claim();
    await setRegistrationPolicy(wb.appPool, ring, {
      policy: "open",
      ...owner,
    });
    const response = await register("ana@gmail.com", "Ana");
    expect(response.status).toBe(200);
  });
});
