import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import {
  ACCOUNT_BEING_DELETED_CODE,
  ACCOUNT_DELETION_CANCELLED_TOPIC,
  ACCOUNT_DELETION_DONE_TOPIC,
  ACCOUNT_DELETION_REQUESTED_TOPIC,
  ACCOUNT_DELETION_TOMORROW_TOPIC,
  ACCOUNT_DELETION_WAIT_DAYS,
  deletionBlock,
  deletionCardFor,
  deletionJustCancelled,
  requestOwnDeletion,
  runDueDeletions,
} from "../src/auth/account-deletion.ts";
import { createAuth } from "../src/auth/auth.ts";
import { DEMO_PERSONAS } from "../src/demo/personas.ts";
import { runOperation } from "../src/operations/operation.ts";
import { dispatchOutbox } from "../src/outbox/handlers.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import { createSCIMToken } from "./sso-create-helper.ts";

/**
 * Deleting your own account (docs/design/account-deletion.md §8 and §9,
 * plan 0.8.0 Y7).
 *
 * The request goes through `requestOwnDeletion`, which is what the server
 * action calls, and sign-ins go through Better Auth's HTTP handler, so the
 * session hook that cancels or refuses runs as it does for a person. The
 * scheduler's pass is called with a fake clock. SMTP is stood in by the
 * outbox: what the relay would send is the row, and the relay's handlers are
 * driven against those rows where a mail's words matter.
 */

type Auth = ReturnType<typeof createAuth>;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PASSWORD = "correct horse battery staple";
const ADMIN = "owner@example.com";
const PERSON = "leaving@example.com";
const DAY = 24 * 60 * 60 * 1000;

let auth: Auth;
let pool: Awaited<ReturnType<typeof workerDb>>["appPool"];

const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0] as string)
    .filter((pair) => !pair.endsWith("="))
    .join("; ");

const send = (path: string, body: unknown, cookie?: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        "x-forwarded-for": "203.0.113.10",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const signUp = async (email: string) => {
  const response = await send("/sign-up/email", {
    email,
    password: PASSWORD,
    name: email,
  });
  expect(response.status).toBe(200);
  return cookieFrom(response);
};

const signIn = (email: string) =>
  send("/sign-in/email", { email, password: PASSWORD });

const admin = async () => (await workerDb()).admin;

const userIdOf = async (email: string) => {
  const { rows } = await (await admin()).query<{ id: string }>(
    "select id from users where email = $1",
    [email],
  );
  return rows[0]?.id as string;
};

const membershipsOf = async (userId: string) => {
  const { rows } = await (await admin()).query<{
    id: string;
    workspace_id: string;
  }>(
    `select id, workspace_id from workspace_members
      where user_id = $1 and deleted_at is null order by created_at`,
    [userId],
  );
  return rows;
};

const addMember = async (
  workspaceId: string,
  userId: string,
  name: string,
): Promise<string> => {
  const { rows } = await (await admin()).query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, $3, 'human', 'active')
     returning id`,
    [workspaceId, userId, name],
  );
  return rows[0]?.id as string;
};

/** A `full` binding on the workspace's own context, as people.test does. */
const grantFull = async (
  workspaceId: string,
  memberId: string,
): Promise<void> => {
  await runOperation(
    { pool },
    {
      action: "test.grant-full",
      workspaceId,
      actor: { kind: "system" },
      async execute({ tx }) {
        const context = await resolveSubjectContext(
          tx,
          "workspace",
          workspaceId,
          workspaceId,
        );
        const groupId = await ensureMemberGroup(tx, { workspaceId, memberId });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId: (context as { contextId: string }).contextId,
          level: ACCESS_LEVELS.full,
        });
        return {
          result: undefined,
          activity: {
            kind: "test.grant-full",
            subjectType: "workspace_member",
            subjectId: memberId,
          },
          audit: { action: "test.grant-full", targetType: "workspace_member" },
        };
      },
    },
  );
};

const queued = async (topic: string) => {
  const { rows } = await (await admin()).query<{
    id: string;
    topic: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
  }>(
    "select id, topic, payload, idempotency_key from outbox where topic = $1 order by created_at, id",
    [topic],
  );
  return rows;
};

const instanceAudit = async (action: string) => {
  const { rows } = await (await admin()).query<{
    payload: Record<string, unknown>;
  }>(
    "select payload from instance_audit_events where action = $1 order by seq",
    [action],
  );
  return rows;
};

const request = async () => {
  const { rows } = await (await admin()).query<{
    id: string;
    runs_at: Date;
    cancelled_at: Date | null;
    cancel_reason: string | null;
    started_at: Date | null;
    completed_at: Date | null;
    workspaces_done: string[];
    last_error: string | null;
  }>("select * from account_deletions order by requested_at desc limit 1");
  return rows[0];
};

/** What the mail would say, through the relay's own handler. */
const mailed = async (topic: string) => {
  const [row] = await queued(topic);
  const sent: { to: string; subject: string; text: string }[] = [];
  await dispatchOutbox(
    {
      topic,
      payload: row?.payload ?? {},
      idempotencyKey: row?.idempotency_key ?? "",
      attempts: 0,
    },
    {
      pool,
      baseUrl: BASE_URL,
      instanceName: "OpenOKR",
      sendMail: async (mail: { to: string; subject: string; text: string }) => {
        sent.push(mail);
      },
    } as unknown as Parameters<typeof dispatchOutbox>[1],
  );
  return sent[0];
};

/**
 * The person: a member of the administrator's workspace, and of their own,
 * where the administrator also holds full access, so they are the last owner
 * of neither (§8's first case).
 */
let adminWorkspace: string;
let ownWorkspace: string;
let personId: string;
let personInAdmin: string;
let personInOwn: string;
let adminInOwn: string;
let personCookie: string;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  pool = wb.appPool;
  await wb.admin.query(
    `insert into system_settings (key, value, source)
     values ('registration.policy', to_jsonb('open'::text), 'admin')
     on conflict (key) do update set value = excluded.value`,
  );
  auth = createAuth({
    pool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
    canSendMail: true,
  });

  await signUp(ADMIN);
  const adminId = await userIdOf(ADMIN);
  adminWorkspace = (await membershipsOf(adminId))[0]?.workspace_id as string;

  personCookie = await signUp(PERSON);
  personId = await userIdOf(PERSON);
  const own = await membershipsOf(personId);
  if (own.length === 0) {
    const provisioned = await provisionWorkspaceForUser(pool, {
      id: personId,
      name: PERSON,
    });
    ownWorkspace = provisioned.workspaceId;
    personInOwn = provisioned.memberId;
  } else {
    ownWorkspace = own[0]?.workspace_id as string;
    personInOwn = own[0]?.id as string;
  }
  personInAdmin = await addMember(adminWorkspace, personId, "Leaving Person");
  adminInOwn = await addMember(ownWorkspace, adminId, "Owner");
  await grantFull(ownWorkspace, adminInOwn);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const ask = (password = PASSWORD, now?: Date) =>
  requestOwnDeletion(auth, pool, {
    headers: new Headers({
      cookie: personCookie,
      "x-forwarded-for": "203.0.113.10",
    }),
    password,
    ...(now ? { now } : {}),
  });

describe("what is refused before anything is asked", () => {
  it("refuses a demonstration account", async () => {
    const persona = DEMO_PERSONAS[0]?.email as string;
    expect(
      await deletionBlock(pool, { userId: personId, email: persona }),
    ).toEqual({ kind: "demo" });
  });

  it("refuses a member a directory manages", async () => {
    await createSCIMToken(pool, adminWorkspace);
    expect(
      await deletionCardFor(pool, {
        userId: personId,
        email: PERSON,
        sessionCreatedAt: new Date(),
      }),
    ).toEqual({ kind: "directory" });
    expect(await ask()).toEqual({ ok: false, reason: "directory" });
    expect(await request()).toBeUndefined();
  });

  it("refuses the last full-access holder, naming the workspace", async () => {
    const adminId = await userIdOf(ADMIN);
    const block = await deletionBlock(pool, { userId: adminId, email: ADMIN });
    expect(block).toMatchObject({
      kind: "last_owner",
      workspaceId: adminWorkspace,
    });
    expect((block as { workspaceName: string }).workspaceName).not.toBe("");
  });

  it("offers the form to anybody else, with the password", async () => {
    expect(
      await deletionCardFor(pool, {
        userId: personId,
        email: PERSON,
        sessionCreatedAt: new Date(),
      }),
    ).toEqual({
      kind: "confirm",
      hasPassword: true,
      recent: true,
      providers: [],
    });
  });
});

describe("asking", () => {
  it("refuses a wrong password and stores nothing", async () => {
    expect(await ask("not the password at all")).toEqual({
      ok: false,
      reason: "wrong_password",
    });
    expect(await request()).toBeUndefined();
  });

  it("stores the request 14 days ahead, ends every session, audits and mails", async () => {
    const now = new Date("2026-11-11T08:00:00Z");
    const outcome = await ask(PASSWORD, now);
    expect(outcome).toEqual({
      ok: true,
      runsAt: new Date(now.getTime() + ACCOUNT_DELETION_WAIT_DAYS * DAY),
    });

    const { rows: sessions } = await (await admin()).query(
      "select 1 from sessions where user_id = $1",
      [personId],
    );
    expect(sessions).toEqual([]);
    expect(await instanceAudit("account.deletion_requested")).toHaveLength(1);
    const mails = await queued(ACCOUNT_DELETION_REQUESTED_TOPIC);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.payload).toMatchObject({ to: PERSON });
    const mail = await mailed(ACCOUNT_DELETION_REQUESTED_TOPIC);
    expect(mail?.subject).toContain("25 November 2026");
    expect(mail?.text).toContain("Sign in before then");

    // Memberships are untouched while it waits.
    expect(await membershipsOf(personId)).toHaveLength(2);
  });
});

describe("waiting", () => {
  it("is cancelled by a sign-in, audited, mailed, and said once", async () => {
    await ask();
    const response = await signIn(PERSON);
    expect(response.status).toBe(200);

    expect(await request()).toMatchObject({ cancel_reason: "signed_in" });
    expect(await instanceAudit("account.deletion_cancelled")).toEqual([
      { payload: { userId: personId, reason: "signed_in" } },
    ]);
    expect(await queued(ACCOUNT_DELETION_CANCELLED_TOPIC)).toHaveLength(1);
    expect(await deletionJustCancelled(pool, personId)).toBe(true);

    // Nothing runs on day 14 any more.
    const pass = await runDueDeletions(pool, {
      now: new Date(Date.now() + 15 * DAY),
    });
    expect(pass).toEqual({
      reminded: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
    });
    expect(await membershipsOf(personId)).toHaveLength(2);
  });

  it("mails the day before, once", async () => {
    await ask();
    const runsAt = (await request())?.runs_at as Date;
    const dayBefore = new Date(runsAt.getTime() - 12 * 60 * 60 * 1000);
    expect((await runDueDeletions(pool, { now: dayBefore })).reminded).toBe(1);
    expect((await runDueDeletions(pool, { now: dayBefore })).reminded).toBe(0);
    expect(await queued(ACCOUNT_DELETION_TOMORROW_TOPIC)).toHaveLength(1);
  });
});

describe("running", () => {
  it("erases every membership as people.erase does, tells who must know, and anonymises the account", async () => {
    // Something they own in the administrator's workspace, so the notice has
    // a reason to go there and not to their own workspace.
    const adminId = await userIdOf(ADMIN);
    const ctx = {
      pool,
      workspaceId: adminWorkspace,
      actor: { kind: "human" as const, userId: adminId },
    };
    const cycle = await callAction(ctx, "cycles.ensureCurrent", {});
    const spaces = (await callAction(ctx, "spaces.list", {})) as Array<{
      id: string;
    }>;
    await callAction(ctx, "goals.create", {
      title: "Land fifty mid-market accounts",
      cycleId: cycle.id,
      level: "company",
      ownerKind: "space",
      spaceId: spaces[0]?.id as string,
      championId: personInAdmin,
      weight: 1,
    });

    await ask();
    const runsAt = (await request())?.runs_at as Date;
    const pass = await runDueDeletions(pool, {
      now: new Date(runsAt.getTime() + 60 * 1000),
    });
    expect(pass).toMatchObject({ completed: 1, failed: 0 });

    const db = await admin();
    const { rows: members } = await db.query<{
      name: string;
      user_id: string | null;
      status: string;
    }>(
      "select name, user_id, status from workspace_members where id = any($1)",
      [[personInAdmin, personInOwn]],
    );
    expect(members).toEqual([
      { name: "Erased member", user_id: null, status: "suspended" },
      { name: "Erased member", user_id: null, status: "suspended" },
    ]);

    // One erasure per workspace, said to be the person's own doing.
    const { rows: audits } = await db.query<{
      workspace_id: string;
      payload: Record<string, unknown>;
    }>(
      "select workspace_id, payload from audit_events where action = 'people.erase'",
    );
    expect(audits.map((row) => row.workspace_id).sort()).toEqual(
      [adminWorkspace, ownWorkspace].sort(),
    );
    for (const row of audits) {
      expect(row.payload.by).toBe("self");
    }

    // The notice: the administrator of the workspace where something needs
    // an owner, and nobody in the workspace where nothing does.
    const { rows: notices } = await db.query<{
      workspace_id: string;
      recipient_member_id: string;
    }>(
      "select workspace_id, recipient_member_id from notifications where reason = 'self_deleted'",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.workspace_id).toBe(adminWorkspace);

    const { rows: account } = await db.query<{ email: string; name: string }>(
      "select email, name from users where id = $1",
      [personId],
    );
    expect(account[0]?.email).toBe(`erased-${personId}@erased.invalid`);
    expect(account[0]?.name).toBe("Erased user");

    // The last mail went to the address it had, read before it was erased.
    const done = await queued(ACCOUNT_DELETION_DONE_TOPIC);
    expect(done).toHaveLength(1);
    expect(done[0]?.payload.to).toBe(PERSON);
    expect(await request()).toMatchObject({
      workspaces_done: expect.arrayContaining([adminWorkspace, ownWorkspace]),
    });
    expect(await instanceAudit("account.deletion_completed")).toHaveLength(1);
  });

  it("refuses a sign-in while the run is erasing", async () => {
    await ask();
    await (await admin()).query(
      "update account_deletions set started_at = now()",
    );
    const response = await signIn(PERSON);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: ACCOUNT_BEING_DELETED_CODE,
    });
    // And the request is not cancelled by it.
    expect(await request()).toMatchObject({ cancelled_at: null });
  });

  it("resumes from the ledger without erasing a workspace twice", async () => {
    await ask();
    const runsAt = (await request())?.runs_at as Date;
    const db = await admin();
    // The administrator's workspace fails once, as a database fault would.
    // Their own workspace comes first, so it is erased before the fault.
    await db.query(
      `create or replace function y7_injected_fault() returns trigger
         language plpgsql as $$ begin raise exception 'injected fault'; end $$`,
    );
    await db.query(
      `create trigger y7_injected_fault before update on workspace_members
         for each row when (old.id = '${personInAdmin}'::uuid)
         execute function y7_injected_fault()`,
    );
    try {
      const first = await runDueDeletions(pool, {
        now: new Date(runsAt.getTime() + 60 * 60 * 1000),
      });
      expect(first).toMatchObject({ completed: 0, failed: 1 });
      expect((await request())?.workspaces_done).toEqual([ownWorkspace]);
      expect((await request())?.last_error).toContain("injected fault");
    } finally {
      await db.query(
        "drop trigger if exists y7_injected_fault on workspace_members",
      );
      await db.query("drop function if exists y7_injected_fault()");
    }

    // The next pass finishes the rest, and erases nothing twice.
    const second = await runDueDeletions(pool, {
      now: new Date(runsAt.getTime() + 2 * 60 * 60 * 1000),
    });
    expect(second).toMatchObject({ completed: 1, failed: 0 });
    const { rows } = await db.query<{ workspace_id: string; n: number }>(
      `select workspace_id, count(*)::int as n from audit_events
        where action = 'people.erase' group by workspace_id`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.n === 1)).toBe(true);
    expect(await request()).toMatchObject({ last_error: null });
  });

  it("asks the refusals again when a pass erased nothing before it failed", async () => {
    await ask();
    const runsAt = (await request())?.runs_at as Date;
    // A pass claimed it and stopped before any erasure, then the other
    // owner of their own workspace left.
    await (await admin()).query(
      "update account_deletions set started_at = runs_at, attempts = 1",
    );
    await (await admin()).query(
      "update workspace_members set deleted_at = now() where id = $1",
      [adminInOwn],
    );
    const pass = await runDueDeletions(pool, {
      now: new Date(runsAt.getTime() + 60 * 60 * 1000),
    });
    expect(pass).toMatchObject({ cancelled: 1, completed: 0 });
    expect(await membershipsOf(personId)).toHaveLength(2);
  });

  it("cancels, erases nothing and mails the workspace when a refusal appeared during the wait", async () => {
    await ask();
    const runsAt = (await request())?.runs_at as Date;
    // The other owner of their own workspace left.
    await (await admin()).query(
      "update workspace_members set deleted_at = now() where id = $1",
      [adminInOwn],
    );

    const pass = await runDueDeletions(pool, {
      now: new Date(runsAt.getTime() + 60 * 1000),
    });
    expect(pass).toMatchObject({ completed: 0, cancelled: 1 });
    expect(await request()).toMatchObject({ cancel_reason: "refused" });
    expect(await membershipsOf(personId)).toHaveLength(2);
    const mails = await queued(ACCOUNT_DELETION_CANCELLED_TOPIC);
    expect(mails[0]?.payload).toMatchObject({
      reason: "refused",
      block: "last_owner",
    });
    const mail = await mailed(ACCOUNT_DELETION_CANCELLED_TOPIC);
    expect(mail?.text).toContain("only owner of");
  });
});
