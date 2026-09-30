import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { createAuth } from "../src/auth/auth.ts";
import { trustedDomainOffers } from "../src/invitations/trusted-domain.ts";
import { listMembershipsForUser } from "../src/workspaces/memberships.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Trusted-domain joining (REQUIREMENTS §4 People and org, P2-T04 "trusted-domain
 * joining works", P6-G06b "trusted-domain joining offered where the workspace
 * allows it"; completeness review M-34).
 *
 * An administrator could save trusted domains and nothing ever read them for
 * anybody outside the workspace, because which workspaces trust a domain was a
 * question the tenant floor answered with nothing. These tests are the whole
 * path a person takes: what they are offered, what joining does, and what it
 * refuses.
 */

const OWNER = "trusted-owner";
const OTHER_OWNER = "trusted-other-owner";

let acme: string;

async function createUser(
  id: string,
  email: string,
  name: string,
  verified: boolean,
) {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email, email_verified) values ($1, $2, $3, $4)",
    [id, name, email, verified],
  );
}

/** Trusts these domains through the general card's own action. */
async function trust(
  workspaceId: string,
  owner: string,
  domains: readonly string[],
) {
  const wb = await workerDb();
  await callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human", userId: owner },
    },
    "settings.updateWorkspaceGeneral",
    { trustedEmailDomains: [...domains] },
  );
}

const join = async (workspaceId: string, userId: string) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId } },
    "invitations.joinByTrustedDomain",
    {},
  );
};

const offers = async (userId: string) => {
  const wb = await workerDb();
  return trustedDomainOffers(wb.appPool, userId);
};

async function memberRows(workspaceId: string, userId: string) {
  const wb = await workerDb();
  const rows = await wb.admin.query<{
    id: string;
    status: string;
    deleted_at: Date | null;
  }>(
    "select id, status, deleted_at from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, userId],
  );
  return rows.rows;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await createUser(OWNER, "owner@acme.example", "Owner", true);
  acme = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Acme" })
  ).workspaceId;
  await wb.admin.query("update workspaces set name = 'Acme' where id = $1", [
    acme,
  ]);
  await trust(acme, OWNER, ["acme.example"]);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a person at a trusted domain", () => {
  it("is offered the workspace, joins it in one step, and is recorded", async () => {
    await createUser("verified", "ada@acme.example", "Ada", true);

    expect(await offers("verified")).toEqual([
      { workspaceId: acme, workspaceName: "Acme" },
    ]);

    const outcome = await join(acme, "verified");
    const [member] = await memberRows(acme, "verified");
    expect(member?.id).toBe(outcome.memberId);
    expect(member?.status).toBe("active");

    // Through the pipeline: the activity row and the audit row, naming the
    // domain that admitted them.
    const wb = await workerDb();
    const audit = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'invitations.joinByTrustedDomain'",
      [acme],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].payload).toMatchObject({
      domain: "acme.example",
      alreadyMember: false,
    });
    const activity = await wb.admin.query(
      "select subject_id from activities where workspace_id = $1 and kind = 'invitation.joined_by_trusted_domain'",
      [acme],
    );
    expect(activity.rows.map((row) => row.subject_id)).toEqual([
      outcome.memberId,
    ]);

    // Once in, there is nothing left to offer.
    expect(await offers("verified")).toEqual([]);
  });

  it("chooses when several workspaces trust the domain, and joins only that one", async () => {
    const wb = await workerDb();
    await createUser(OTHER_OWNER, "boss@acme.example", "Boss", true);
    const labs = (
      await provisionWorkspaceForUser(wb.appPool, {
        id: OTHER_OWNER,
        name: "Labs",
      })
    ).workspaceId;
    await wb.admin.query(
      "update workspaces set name = 'Acme Labs' where id = $1",
      [labs],
    );
    await trust(labs, OTHER_OWNER, ["acme.example", "labs.example"]);

    await createUser("chooser", "grace@acme.example", "Grace", true);
    // Both, by name, so the page lists them in an order a person can read.
    expect(await offers("chooser")).toEqual([
      { workspaceId: acme, workspaceName: "Acme" },
      { workspaceId: labs, workspaceName: "Acme Labs" },
    ]);

    await join(labs, "chooser");
    expect(await memberRows(labs, "chooser")).toHaveLength(1);
    expect(await memberRows(acme, "chooser")).toHaveLength(0);
    expect(await offers("chooser")).toEqual([
      { workspaceId: acme, workspaceName: "Acme" },
    ]);
  });
});

describe("what is refused", () => {
  it("an unconfirmed address is offered nothing and cannot join", async () => {
    // Anybody can type somebody else's company address into a sign-up form.
    await createUser("unverified", "mallory@acme.example", "Mallory", false);

    expect(await offers("unverified")).toEqual([]);
    await expect(join(acme, "unverified")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await memberRows(acme, "unverified")).toHaveLength(0);
  });

  it("a domain the workspace does not trust is offered nothing and cannot join", async () => {
    await createUser("outsider", "eve@elsewhere.example", "Eve", true);

    expect(await offers("outsider")).toEqual([]);
    await expect(join(acme, "outsider")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await memberRows(acme, "outsider")).toHaveLength(0);
  });

  it("a suspended member is not offered the workspace and is not let back in", async () => {
    await createUser("suspended", "sam@acme.example", "Sam", true);
    const { memberId } = await join(acme, "suspended");

    const wb = await workerDb();
    await callAction(
      {
        pool: wb.appPool,
        workspaceId: acme,
        actor: { kind: "human", userId: OWNER },
      },
      "people.suspend",
      { memberId },
    );

    expect(await offers("suspended")).toEqual([]);
    await expect(join(acme, "suspended")).rejects.toMatchObject({
      code: "forbidden",
    });
    const rows = await memberRows(acme, "suspended");
    expect(rows.map((row) => row.status)).toEqual(["suspended"]);
  });

  it("a removed member is not offered the workspace and is not added again", async () => {
    await createUser("removed", "rae@acme.example", "Rae", true);
    const { memberId } = await join(acme, "removed");

    // No action removes a member today; a removal is a deleted row, which is
    // what an importer or a later lifecycle action leaves.
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set deleted_at = now() where id = $1",
      [memberId],
    );

    expect(await offers("removed")).toEqual([]);
    await expect(join(acme, "removed")).rejects.toMatchObject({
      code: "forbidden",
    });
    const live = (await memberRows(acme, "removed")).filter(
      (row) => row.deleted_at === null,
    );
    expect(live).toHaveLength(0);
  });

  it("a full workspace refuses, naming the seats", async () => {
    // A cloud workspace on a plan of one seat, which the owner holds.
    const wb = await workerDb();
    await wb.admin.query(
      "insert into tenants (workspace_id, state, region, seats) values ($1, 'active', 'local', 1)",
      [acme],
    );
    await createUser("late", "lee@acme.example", "Lee", true);

    await expect(join(acme, "late")).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringMatching(/1 of 1 seats/),
    });
    expect(await memberRows(acme, "late")).toHaveLength(0);
  });

  it("a frozen workspace is not offered, because joining it would fail", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspaces set state = 'frozen' where id = $1",
      [acme],
    );
    await createUser("frozen-out", "fay@acme.example", "Fay", true);

    expect(await offers("frozen-out")).toEqual([]);
    await expect(join(acme, "frozen-out")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("the cross-tenant read", () => {
  it("reveals a workspace's id and name and nothing else", async () => {
    await createUser("reader", "rita@acme.example", "Rita", true);

    const found = await offers("reader");
    expect(found).toHaveLength(1);
    // Exactly two keys. The row that made this readable holds the whole
    // settings map, and none of it may reach a person outside the workspace.
    expect(Object.keys(found[0] ?? {}).sort()).toEqual([
      "workspaceId",
      "workspaceName",
    ]);
    expect(JSON.stringify(found)).not.toContain("trustedEmailDomains");
    expect(JSON.stringify(found)).not.toContain("timezone");
  });

  it("does not reveal a workspace that trusts some other domain", async () => {
    const wb = await workerDb();
    await createUser(OTHER_OWNER, "boss@other.example", "Boss", true);
    const other = (
      await provisionWorkspaceForUser(wb.appPool, {
        id: OTHER_OWNER,
        name: "Other",
      })
    ).workspaceId;
    await trust(other, OTHER_OWNER, ["other.example"]);

    await createUser("reader", "rita@acme.example", "Rita", true);
    const found = await offers("reader");
    expect(found.map((offer) => offer.workspaceId)).toEqual([acme]);
  });

  it("answers nothing, rather than failing, for an address no domain could match", async () => {
    // The key refuses anything that is not a plain lower-case domain by
    // throwing, and an account like this is ordinary rather than an error.
    await createUser("odd", "odd@localhost", "Odd", true);
    expect(await offers("odd")).toEqual([]);
  });
});

describe("signing up at a trusted domain", () => {
  const BASE_URL = "http://localhost:3000";
  const PASSWORD = "correct horse battery staple";

  const register = async (email: string, name: string) => {
    const wb = await workerDb();
    const auth = createAuth({
      pool: wb.appPool,
      secret: "a-test-secret-of-sufficient-length-for-signing",
      baseUrl: BASE_URL,
      rateLimit: { enabled: false },
    });
    return auth.handler(
      new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD, name }),
      }),
    );
  };

  const userIdFor = async (email: string) => {
    const wb = await workerDb();
    const rows = await wb.admin.query("select id from users where email = $1", [
      email,
    ]);
    return rows.rows[0]?.id as string;
  };

  beforeEach(async () => {
    // Registration open, as on a cloud instance or one an operator opened.
    const wb = await workerDb();
    await wb.admin.query(
      `insert into system_settings (key, value, created_at, updated_at)
       values ('registration.policy', to_jsonb('open'::text), now(), now())
       on conflict (key) do update set value = excluded.value`,
    );
  });

  it("holds off a workspace of their own, so the one that trusts them can be offered first", async () => {
    const response = await register("new@acme.example", "Newcomer");
    expect(response.status).toBe(200);

    const wb = await workerDb();
    const memberships = await listMembershipsForUser(
      wb.appPool,
      await userIdFor("new@acme.example"),
    );
    expect(memberships).toEqual([]);
  });

  it("still gives anybody else a workspace of their own straight away", async () => {
    const response = await register("new@elsewhere.example", "Elsewhere");
    expect(response.status).toBe(200);

    const wb = await workerDb();
    const memberships = await listMembershipsForUser(
      wb.appPool,
      await userIdFor("new@elsewhere.example"),
    );
    expect(memberships).toHaveLength(1);
  });
});
