import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import {
  checkSetupCode,
  hashSetupCode,
  normaliseSetupCode,
  prepareSetupCode,
  setupCodeMatches,
} from "../src/setup/setup-code.ts";
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

/**
 * The setup code that claims a new instance (docs/design/setup-code.md,
 * plan 0.9.0 G1). Each case is one of the design's acceptance criteria.
 *
 * These build the instance with `setupCode` set, which is what the web app
 * does. Every other case in this file builds it without, because they are
 * about the policy and not about the claim.
 */
describe("the setup code", () => {
  const OWNER = "owner@founder.example";
  const ENV_CODE = "K7M2-9PQX-4TVD";
  const roots: string[] = [];

  /** A storage root of its own, so no test writes beside another's file. */
  const newRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), "openokr-setup-code-"));
    roots.push(root);
    return root;
  };

  const registerWith = async (instance: Auth, email: string, code?: string) =>
    instance.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(code === undefined ? {} : { "x-openokr-setup-code": code }),
        },
        body: JSON.stringify({ email, password: PASSWORD, name: "Owner" }),
      }),
    );

  const storedHashRows = async (): Promise<number> => {
    const wb = await workerDb();
    const rows = await wb.admin.query<{ n: number }>(
      "select count(*)::int as n from system_settings where key = 'setup.codeHash'",
    );
    return rows.rows[0]?.n ?? 0;
  };

  let instance: Auth;

  beforeEach(async () => {
    const wb = await workerDb();
    await wb.admin.query("delete from system_settings");
    instance = createAuth({
      pool: wb.appPool,
      secret: SECRET,
      baseUrl: BASE_URL,
      rateLimit: { enabled: false },
      setupCode: { environmentCode: normaliseSetupCode(ENV_CODE) },
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("refuses a sign-up with no code, creates nobody and says which refusal", async () => {
    const response = await registerWith(instance, OWNER);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "SETUP_CODE_REQUIRED",
      message: "That setup code is not right. Check it and try again.",
    });
    expect(await usersCalled(OWNER)).toBe(0);
  });

  it("refuses a wrong code with its own error code", async () => {
    const response = await registerWith(instance, OWNER, "ZZZZ-ZZZZ-ZZZZ");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "SETUP_CODE_WRONG" });
    expect(await usersCalled(OWNER)).toBe(0);
  });

  it("claims the instance with the code in any case, with or without dashes, and setup can finish", async () => {
    const wb = await workerDb();
    const response = await registerWith(instance, OWNER, "k7m2 9pqx 4tvd");
    expect(response.status).toBe(200);
    expect(await usersCalled(OWNER)).toBe(1);
    const verified = await wb.admin.query<{ email_verified: boolean }>(
      "select email_verified from users where email = $1",
      [OWNER],
    );
    expect(verified.rows[0]?.email_verified).toBe(true);

    const done = await completeSetup(wb.appPool, ring, { settings: [] });
    expect(done.claimed).toBe(true);
    expect((await readSetupState(wb.appPool)).configured).toBe(true);
  });

  it("ignores the code once the instance is claimed, and the registration policy decides", async () => {
    vi.stubEnv("OPENOKR_REGISTRATION", "invite_only");
    const wb = await workerDb();
    expect((await registerWith(instance, OWNER, ENV_CODE)).status).toBe(200);
    await completeSetup(wb.appPool, ring, { settings: [] });

    // Neither the old code nor the lack of one changes the answer: closed.
    for (const code of [ENV_CODE, undefined]) {
      const second = await registerWith(instance, "ana@acme.example", code);
      expect(second.status).toBeGreaterThanOrEqual(400);
      const text = await second.text();
      expect(text).toContain(REGISTRATION_CLOSED_MESSAGE);
      expect(text).not.toContain("SETUP_CODE");
    }
    expect(await usersCalled("ana@acme.example")).toBe(0);
  });

  it("makes a code at boot when none is set, stores only its hash and writes the file", async () => {
    const wb = await workerDb();
    const root = await newRoot();
    const made = await prepareSetupCode(wb.appPool, {
      secret: SECRET,
      storageRoot: root,
    });
    expect(made.outcome).toBe("made");
    expect(await storedHashRows()).toBe(1);

    const file = join(root, "setup-code");
    const code = (await readFile(file, "utf8")).trim();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect((await stat(file)).mode & 0o777).toBe(0o600);

    // The stored value is the keyed hash, never the code.
    const stored = await wb.admin.query<{ value: string }>(
      "select value from system_settings where key = 'setup.codeHash'",
    );
    expect(stored.rows[0]?.value).toBe(hashSetupCode(SECRET, code));
    expect(stored.rows[0]?.value).not.toContain(code.replaceAll("-", ""));

    // And the file's code passes the real sign-up, with no environment code.
    const generated = withCodeOn(wb.appPool);
    expect((await registerWith(generated, OWNER, code)).status).toBe(200);
  });

  it("refuses the wrong code when the code is the generated one", async () => {
    const wb = await workerDb();
    await prepareSetupCode(wb.appPool, {
      secret: SECRET,
      storageRoot: await newRoot(),
    });
    const generated = withCodeOn(wb.appPool);
    const response = await registerWith(generated, OWNER, "ZZZZ-ZZZZ-ZZZZ");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "SETUP_CODE_WRONG" });
  });

  it("leaves one hash row and a file whose code passes when two processes boot together", async () => {
    const wb = await workerDb();
    const root = await newRoot();
    const outcomes = await Promise.all([
      prepareSetupCode(wb.appPool, { secret: SECRET, storageRoot: root }),
      prepareSetupCode(wb.appPool, { secret: SECRET, storageRoot: root }),
    ]);
    expect(outcomes.map((one) => one.outcome).sort()).toEqual([
      "exists",
      "made",
    ]);
    expect(await storedHashRows()).toBe(1);
    const code = (await readFile(join(root, "setup-code"), "utf8")).trim();
    const stored = await wb.admin.query<{ value: string }>(
      "select value from system_settings where key = 'setup.codeHash'",
    );
    expect(setupCodeMatches(SECRET, code, stored.rows[0]?.value ?? "")).toBe(
      true,
    );
  });

  it("makes no code for a claimed instance, so an upgrade writes no file", async () => {
    const wb = await workerDb();
    const root = await newRoot();
    // Claimed the way every other case here claims: without the option.
    await claim();
    const result = await prepareSetupCode(wb.appPool, {
      secret: SECRET,
      storageRoot: root,
    });
    expect(result.outcome).toBe("not-needed");
    expect(await storedHashRows()).toBe(0);
    await expect(readFile(join(root, "setup-code"))).rejects.toThrow();
  });

  it("makes no code when the deployment set one, and drops a generated one left from before", async () => {
    const wb = await workerDb();
    const root = await newRoot();
    await prepareSetupCode(wb.appPool, { secret: SECRET, storageRoot: root });
    const generated = (await readFile(join(root, "setup-code"), "utf8")).trim();

    const result = await prepareSetupCode(wb.appPool, {
      secret: SECRET,
      storageRoot: root,
      environmentCode: normaliseSetupCode(ENV_CODE),
    });
    expect(result.outcome).toBe("environment");
    expect(await storedHashRows()).toBe(0);
    await expect(readFile(join(root, "setup-code"))).rejects.toThrow();

    // The deployment's code decides alone, so the leaked one is dead (Q2).
    expect(
      await checkSetupCode(
        wb.appPool,
        SECRET,
        generated,
        normaliseSetupCode(ENV_CODE),
      ),
    ).toBe("wrong");
  });

  it("deletes the hash and the file when setup finishes", async () => {
    const wb = await workerDb();
    const root = await newRoot();
    await prepareSetupCode(wb.appPool, { secret: SECRET, storageRoot: root });
    const code = (await readFile(join(root, "setup-code"), "utf8")).trim();
    const generated = withCodeOn(wb.appPool);
    expect((await registerWith(generated, OWNER, code)).status).toBe(200);

    await completeSetup(wb.appPool, ring, { settings: [], storageRoot: root });

    expect(await storedHashRows()).toBe(0);
    await expect(readFile(join(root, "setup-code"))).rejects.toThrow();
  });

  /** An instance with no environment code, so the stored hash decides. */
  function withCodeOn(pool: Parameters<typeof createAuth>[0]["pool"]): Auth {
    return createAuth({
      pool,
      secret: SECRET,
      baseUrl: BASE_URL,
      rateLimit: { enabled: false },
      setupCode: {},
    });
  }
});
