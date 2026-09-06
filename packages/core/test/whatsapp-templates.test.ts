import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Syncing Meta's approved templates (P5-T04b-a).
 *
 * **A mirror, not a merge.** Nothing here is authored in this product, so a sync
 * has no local edit to overwrite: it records what Meta says now and withdraws
 * what Meta no longer lists. That is the property most of these tests are about,
 * because it is the one that would be wrong in an obvious way six months from
 * now if it were built as an append.
 *
 * The fetch itself is `packages/adapters`: the parsing of Meta's shape and the
 * counting of a body's variables are tested there, against a stubbed fetch.
 */

const ADMIN = "template-admin";
const PHONE_NUMBER_ID = "123456789012345";

let workspaceId: string;

const ring = parseKeyRing({
  current: Buffer.alloc(32, 11).toString("base64"),
  previous: [],
});

const context = async () => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: ADMIN },
    ring,
  };
};

const template = (over: Record<string, unknown> = {}) => ({
  metaId: "meta-1",
  name: "checkin_due",
  language: "en",
  status: "APPROVED",
  category: "UTILITY",
  bodyText: "Hi {{1}}, your check-in for {{2}} is due.",
  variables: 2,
  ...over,
});

const sync = async (templates: Record<string, unknown>[]) =>
  callAction(await context(), "channels.syncTemplates", {
    templates: templates as never,
  });

const list = async () =>
  (await callAction(await context(), "channels.templates", {})).templates;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [ADMIN, "Admin", "template-admin@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: ADMIN,
    name: "Admin",
  });
  workspaceId = provisioned.workspaceId;

  await callAction(await context(), "channels.connect", {
    provider: "whatsapp",
    credentials: JSON.stringify({
      accessToken: "a-token",
      appSecret: "a-secret",
      verifyToken: "a-verify-token",
    }),
    config: { teamId: PHONE_NUMBER_ID },
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("recording what a sync found", () => {
  it("records a template with its body and the variables it expects", async () => {
    const outcome = await sync([template()]);
    expect(outcome).toEqual({ recorded: 1, withdrawn: 0 });

    const [stored] = await list();
    expect(stored?.name).toBe("checkin_due");
    expect(stored?.status).toBe("APPROVED");
    expect(stored?.language).toBe("en");
    expect(stored?.variables).toBe(2);
    // The body as Meta holds it, placeholders and all, so the screen can show
    // what will actually arrive.
    expect(stored?.bodyText).toContain("{{1}}");
  });

  it("updates a template rather than adding a second one", async () => {
    await sync([template()]);
    await sync([
      template({ status: "PAUSED", bodyText: "Hi {{1}}.", variables: 1 }),
    ]);

    const all = await list();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe("PAUSED");
    expect(all[0]?.variables).toBe(1);
  });

  it("withdraws what Meta no longer lists, and says how many", async () => {
    await sync([
      template(),
      template({ metaId: "meta-2", name: "blocker_open" }),
    ]);
    expect(await list()).toHaveLength(2);

    const outcome = await sync([template()]);
    expect(outcome).toEqual({ recorded: 1, withdrawn: 1 });

    const all = await list();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("checkin_due");
  });

  it("brings back a template Meta lists again, as the same row", async () => {
    const wb = await workerDb();
    await sync([template()]);
    await sync([]);
    expect(await list()).toHaveLength(0);

    await sync([template()]);
    const all = await list();
    expect(all).toHaveLength(1);

    // One template is one row for the life of the workspace, which is what lets
    // a mapping still say which one it meant.
    const rows = await wb.admin.query(
      "select count(*)::int as count from whatsapp_templates where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.rows[0].count).toBe(1);
  });

  it("withdraws everything when Meta lists nothing", async () => {
    await sync([template(), template({ metaId: "meta-2", name: "other" })]);
    // The true answer for an account whose templates were all removed, rather
    // than a sync that quietly does nothing.
    expect(await sync([])).toEqual({ recorded: 0, withdrawn: 2 });
    expect(await list()).toHaveLength(0);
  });

  it("keeps a template that is not approved, and says which", async () => {
    await sync([
      template(),
      template({ metaId: "meta-2", name: "pending_one", status: "PENDING" }),
      template({ metaId: "meta-3", name: "rejected_one", status: "REJECTED" }),
    ]);

    const all = await list();
    // An administrator wants to know their submission is pending rather than
    // that it does not exist.
    expect(all.map((row) => row.status).sort()).toEqual([
      "APPROVED",
      "PENDING",
      "REJECTED",
    ]);
  });

  it("audits the sync with what it changed", async () => {
    const wb = await workerDb();
    await sync([template()]);
    await sync([]);

    const audited = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'channels.syncTemplates' order by at",
      [workspaceId],
    );
    expect(audited.rows).toHaveLength(2);
    expect((audited.rows[1].payload as Record<string, unknown>).withdrawn).toBe(
      1,
    );
  });
});

describe("the tenant floor", () => {
  it("keeps one workspace's templates out of another's", async () => {
    const wb = await workerDb();
    await sync([template()]);

    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      ["other-admin", "Other", "other-admin@example.com"],
    );
    const second = await provisionWorkspaceForUser(wb.appPool, {
      id: "other-admin",
      name: "Other",
    });

    const theirs = await callAction(
      {
        pool: wb.appPool,
        workspaceId: second.workspaceId,
        actor: { kind: "human", userId: "other-admin" },
        ring,
      },
      "channels.templates",
      {},
    );
    // Their own Meta account, their own templates. Nothing crosses.
    expect(theirs.templates).toHaveLength(0);
  });
});
