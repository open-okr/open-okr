import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { INVENTED_CAST } from "../src/demo/cast.ts";
import {
  inboxProblem,
  passwordProblem,
  personaAddress,
  prepareUatPersonas,
  UAT_PERSONA_PASSWORD,
} from "../src/demo/uat-personas.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The seven Northwind people as members who can sign in, on a workspace that
 * holds nothing else (the UAT workbook, docs/testing).
 *
 * The point of the command is that the tester skips seven sign-ups and still
 * gets members indistinguishable from invited ones, so the tests check the
 * join went through the invitation, and that signing in works through Better
 * Auth rather than by reading a row.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const OWNER = "uat-owner";
const INBOX = "qa@uat.example";

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;
let workspaceId: string;

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "UAT Owner", "uat-owner@example.com"],
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
    rateLimit: { enabled: false },
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const prepare = async (inbox = INBOX) =>
  prepareUatPersonas({
    pool: (await workerDb()).appPool,
    workspaceId,
    adminUserId: OWNER,
    auth,
    inbox,
  });

describe("the addresses", () => {
  it("hangs a plus-address per persona off one inbox", () => {
    expect(personaAddress("QA@Example.com", "priya")).toBe(
      "qa+priya@example.com",
    );
  });

  it("refuses something that is not an address, or already has a plus", () => {
    expect(inboxProblem("qa")).not.toBeNull();
    expect(inboxProblem("qa@")).not.toBeNull();
    expect(inboxProblem("qa+x@example.com")).not.toBeNull();
    expect(inboxProblem("qa@example.com")).toBeNull();
  });

  it("refuses a password shorter than the sign-up page allows", () => {
    expect(passwordProblem("short")).not.toBeNull();
    expect(passwordProblem(UAT_PERSONA_PASSWORD)).toBeNull();
  });
});

describe("a workspace with nobody but its founder", () => {
  it("gets all seven people", async () => {
    const outcome = await prepare();
    expect(outcome.joined).toBe(INVENTED_CAST.length);
    expect(outcome.personas.map((one) => one.email)).toEqual(
      INVENTED_CAST.map((one) => personaAddress(INBOX, one.key)),
    );
  });

  it("joined them through one invitation, which is now revoked", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select use_count, revoked_at from invite_links
        where workspace_id = $1 and deleted_at is null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.use_count).toBe(INVENTED_CAST.length);
    expect(rows[0]?.revoked_at).not.toBeNull();

    const audit = await wb.admin.query(
      `select count(*)::int as n from audit_events
        where workspace_id = $1 and action = 'invitations.acceptLink'`,
      [workspaceId],
    );
    expect(audit.rows[0]?.n).toBe(INVENTED_CAST.length);
  });

  it("leaves titles and managers for the tester to set", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select m.name, m.title, m.manager_id from workspace_members m
         join users u on u.id = m.user_id
        where m.workspace_id = $1 and u.email = $2`,
      [workspaceId, personaAddress(INBOX, "priya")],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Priya Raman");
    expect(rows[0]?.title ?? null).toBeNull();
    expect(rows[0]?.manager_id ?? null).toBeNull();
  });

  it("gives no persona a private workspace of their own", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from workspaces where deleted_at is null",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("lets a persona sign in through Better Auth", async () => {
    const ok = await auth.api.signInEmail({
      body: {
        email: personaAddress(INBOX, "sara"),
        password: UAT_PERSONA_PASSWORD,
      },
      asResponse: true,
    });
    expect(ok.status).toBe(200);
    const wrong = await auth.api.signInEmail({
      body: {
        email: personaAddress(INBOX, "sara"),
        password: "wrong-password",
      },
      asResponse: true,
    });
    expect(wrong.status).toBe(401);
  });

  it("changes nothing when it runs again", async () => {
    const again = await prepare();
    expect(again.joined).toBe(0);
    expect(again.personas).toHaveLength(INVENTED_CAST.length);
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from users where email like 'qa+%@uat.example'",
    );
    expect(rows[0]?.n).toBe(INVENTED_CAST.length);
  });
});

describe("a workspace somebody is using", () => {
  it("is refused before any account is made", async () => {
    // A different inbox, so the seven members above now count as strangers:
    // exactly what a real organisation's members look like to this command.
    await expect(prepare("other@uat.example")).rejects.toBeInstanceOf(
      OperationError,
    );
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from users where email like 'other+%'",
    );
    expect(rows[0]?.n).toBe(0);
  });
});
