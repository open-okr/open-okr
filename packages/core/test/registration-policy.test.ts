import { workerDb } from "@openokr/test-support/db";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { completeSetup } from "../src/setup/complete.ts";
import { readSetupState } from "../src/setup/state.ts";
import {
  COMPANY_EMAIL_MESSAGE,
  REGISTRATION_CLOSED_MESSAGE,
  readRegistrationPolicy,
  registrationPolicyOrigin,
  registrationRefusal,
  setRegistrationPolicy,
  setRegistrationPolicyAsOperator,
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

// registration-policy.md §9 D12 to D15, plan 0.7.0 B1: on a cloud the policy
// is the operator's, set on S-47, saved with its own source and recorded on
// the instance chain.
describe("an operator setting the policy", () => {
  it("stores it as the operator's and writes one instance audit event naming them", async () => {
    const wb = await workerDb();
    await claim();
    await wb.admin.query(
      "insert into users (id, name, email) values ('operator', 'Op', 'op@example.com'), ('granter', 'Gr', 'gr@example.com') on conflict do nothing",
    );
    await wb.admin.query(
      "insert into instance_operators (user_id, granted_by_user_id) values ('operator', 'granter')",
    );
    const outcome = await setRegistrationPolicyAsOperator(wb.appPool, ring, {
      policy: "open",
      operatorUserId: "operator",
    });
    expect(outcome).toBe("changed");

    const { rows } = await wb.admin.query<{ source: string }>(
      "select source from system_settings where key = 'registration.policy'",
    );
    expect(rows[0]?.source).toBe("operator");
    expect(await registrationPolicyOrigin(wb.appPool, NO_VARIABLE)).toBe(
      "operator",
    );
    const events = await wb.admin.query<{
      payload: Record<string, unknown>;
    }>(
      "select payload from instance_audit_events where action = 'instance.registration_changed'",
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.payload).toMatchObject({
      to: "open",
      operatorUserId: "operator",
    });
  });

  it("refuses somebody who is not an operator, as not-found", async () => {
    const wb = await workerDb();
    const owner = await claim();
    await expect(
      setRegistrationPolicyAsOperator(wb.appPool, ring, {
        policy: "open",
        operatorUserId: owner.userId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
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

/**
 * A closed policy must not stop the claim (registration-policy.md §10 D17,
 * plan 0.8.0 H3).
 *
 * The setup wizard's sign-up is the claim. `OPENOKR_REGISTRATION=invite_only`
 * means "closed behind the owner", so it was refusing the owner too, and the
 * instance could never be claimed. An unclaimed instance, setup unfinished and
 * no account, now admits its first account whatever the policy says, and the
 * policy governs every account after it.
 */
describe("the first account on an unclaimed instance", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The address the wizard is filled in with: free mail, the hardest case. */
  const OWNER = "owner@gmail.com";

  const emailVerified = async (email: string): Promise<boolean | undefined> => {
    const wb = await workerDb();
    const rows = await wb.admin.query<{ email_verified: boolean }>(
      "select email_verified from users where email = $1",
      [email],
    );
    return rows.rows[0]?.email_verified;
  };

  const closings: readonly [string, "invite_only" | "company_domains"][] = [
    ["invitation only", "invite_only"],
    ["company addresses only", "company_domains"],
  ];

  it.each(closings)(
    "is admitted with %s from the variable, verified, and setup finishes",
    async (_name, policy) => {
      vi.stubEnv("OPENOKR_REGISTRATION", policy);
      const response = await register(OWNER, "Owner");
      expect(response.status).toBe(200);
      expect(await usersCalled(OWNER)).toBe(1);
      expect(await emailVerified(OWNER)).toBe(true);

      const wb = await workerDb();
      const finished = await completeSetup(wb.appPool, ring, { settings: [] });
      expect(finished.claimed).toBe(true);
      expect((await readSetupState(wb.appPool)).configured).toBe(true);
    },
  );

  it.each(closings)("is admitted with %s stored", async (_name, policy) => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "registration.policy", value: policy, source: "admin" },
    ]);
    const response = await register(OWNER, "Owner");
    expect(response.status).toBe(200);
    expect(await usersCalled(OWNER)).toBe(1);
    expect(await emailVerified(OWNER)).toBe(true);
  });

  it("leaves the policy to govern the next sign-up, which is refused with the closed sentence", async () => {
    vi.stubEnv("OPENOKR_REGISTRATION", "invite_only");
    expect((await register(OWNER, "Owner")).status).toBe(200);
    const wb = await workerDb();
    await completeSetup(wb.appPool, ring, { settings: [] });

    const second = await register("ana@acme.example", "Ana");
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(await second.text()).toContain(REGISTRATION_CLOSED_MESSAGE);
    expect(await usersCalled("ana@acme.example")).toBe(0);
  });

  it("refuses a second account while setup is still unfinished, because one exists", async () => {
    vi.stubEnv("OPENOKR_REGISTRATION", "invite_only");
    expect((await register(OWNER, "Owner")).status).toBe(200);

    const second = await register("ana@acme.example", "Ana");
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(await second.text()).toContain(REGISTRATION_CLOSED_MESSAGE);
    expect(await usersCalled("ana@acme.example")).toBe(0);
  });
});
