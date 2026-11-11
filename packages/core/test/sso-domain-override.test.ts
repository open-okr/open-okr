import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { SSOConnectionRejected } from "../src/auth/sso.ts";
import { markDomainVerifiedAsOperator } from "../src/operator/domains.ts";
import {
  asOwner,
  domainRow,
  seedVerifiedDomain,
  workspaceFor,
} from "./sso-domain-fixtures.ts";

/**
 * An instance administrator marking a domain verified by hand
 * (docs/design/sso-domain-verification.md, rule 6, for an instance with no
 * public DNS).
 *
 * "Instance administrator" is the instance operator grant, the one
 * `pnpm cloud:operator` makes. A workspace's own administrator is not one.
 */

let ws: string;

const OPERATOR = "instance-admin";

const mark = async (
  over: Partial<{
    operatorUserId: string;
    domain: string;
    reason: string;
  }> = {},
) => {
  const wb = await workerDb();
  return markDomainVerifiedAsOperator(wb.appPool, {
    operatorUserId: OPERATOR,
    workspaceId: ws,
    domain: "airgap.example",
    reason: "No public DNS on this network. Checked the domain with IT.",
    ...over,
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  ws = await workspaceFor("owner-a", "Workspace A");
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2)",
    [OPERATOR, "admin@instance.example"],
  );
  await wb.admin.query(
    "insert into instance_operators (user_id, granted_by_user_id) values ($1, 'owner-a')",
    [OPERATOR],
  );
});

afterAll(async () => {
  await (await workerDb()).close();
});

describe("marking a domain verified by hand", () => {
  it("verifies it, and the audit row names the administrator and the reason", async () => {
    const result = await mark();

    expect(result).toEqual({ domain: "airgap.example", verified: true });
    const row = await domainRow(ws, "airgap.example");
    expect(row?.verified_at).not.toBeNull();
    expect(row?.verified_by).toBe(OPERATOR);

    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select payload::text as p from audit_events where action = 'sso.markDomainVerified'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p).toContain("No public DNS");
    expect(rows[0]?.p).toContain('"authority": "operator"');
    const actor = await wb.admin.query(
      "select actor_kind, actor_operator_user_id from audit_events where action = 'sso.markDomainVerified'",
    );
    expect(actor.rows[0]).toEqual({
      actor_kind: "operator",
      actor_operator_user_id: OPERATOR,
    });
  });

  it("verifies a domain whose verification was already started", async () => {
    await callAction(
      await asOwner("owner-a", ws),
      "sso.startDomainVerification",
      {
        domain: "airgap.example",
      },
    );

    await mark();

    const [listed] = await callAction(
      await asOwner("owner-a", ws),
      "sso.listDomains",
      {},
    );
    expect(listed).toMatchObject({
      status: "verified",
      verifiedBy: "administrator",
    });
  });

  it("is refused to somebody who is not an instance administrator, as not found", async () => {
    await expect(mark({ operatorUserId: "owner-a" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await domainRow(ws, "airgap.example")).toBeUndefined();
  });

  it("needs a reason", async () => {
    await expect(mark({ reason: "   " })).rejects.toThrow();
    expect(await domainRow(ws, "airgap.example")).toBeUndefined();
  });

  it("still refuses a free-mail domain", async () => {
    await expect(mark({ domain: "gmail.com" })).rejects.toBeInstanceOf(
      SSOConnectionRejected,
    );
  });

  it("still refuses a domain another workspace verified", async () => {
    const other = await workspaceFor("owner-b", "Workspace B");
    await seedVerifiedDomain(other, "airgap.example");

    await expect(mark()).rejects.toBeInstanceOf(SSOConnectionRejected);
  });
});

/**
 * The self-hosted way in: the administrator of the workspace, on an instance
 * that is not a managed cloud. The codebase's one answer to "who is the
 * instance administrator" is that (the instance-name card and the AI endpoint
 * guard read it the same way), so this reuses it rather than adding another.
 */
describe("marking a domain verified by hand as an instance administrator", () => {
  const setCloud = async (on: boolean) => {
    const wb = await workerDb();
    await wb.admin.query(
      "delete from system_settings where key = 'cloud.enabled'",
    );
    if (on) {
      await wb.admin.query(
        "insert into system_settings (key, value) values ('cloud.enabled', 'true'::jsonb)",
      );
    }
  };
  const input = { domain: "airgap.example", reason: "No public DNS here." };

  afterAll(async () => setCloud(false));

  it("is allowed to the administrator of a self-hosted instance, and the audit row says which authority", async () => {
    await setCloud(false);

    const result = await callAction(
      await asOwner("owner-a", ws),
      "sso.markDomainVerified",
      input,
    );

    expect(result).toEqual({ domain: "airgap.example", verified: true });
    expect((await domainRow(ws, "airgap.example"))?.verified_by).toBe(
      "owner-a",
    );
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select payload::text as p from audit_events where action = 'sso.markDomainVerified'",
    );
    expect(rows[0]?.p).toContain('"authority": "instance_admin"');
    expect(rows[0]?.p).toContain("owner-a");
    expect(rows[0]?.p).toContain("No public DNS here.");
  });

  it("is refused to a workspace administrator on a managed cloud", async () => {
    await setCloud(true);

    await expect(
      callAction(await asOwner("owner-a", ws), "sso.markDomainVerified", input),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await domainRow(ws, "airgap.example")).toBeUndefined();
  });

  it("is refused to a member below full", async () => {
    await setCloud(false);
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Ordinary', 'human', 'active')
       returning id`,
      [ws],
    );

    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId: ws,
          actor: { kind: "human", memberId: rows[0]?.id as string },
        },
        "sso.markDomainVerified",
        input,
      ),
    ).rejects.toThrow();
    expect(await domainRow(ws, "airgap.example")).toBeUndefined();
  });

  it("needs a reason and refuses free mail, as the operator's way does", async () => {
    await setCloud(false);
    const owner = await asOwner("owner-a", ws);

    await expect(
      callAction(owner, "sso.markDomainVerified", { ...input, reason: " " }),
    ).rejects.toThrow();
    await expect(
      callAction(owner, "sso.markDomainVerified", {
        ...input,
        domain: "gmail.com",
      }),
    ).rejects.toBeInstanceOf(SSOConnectionRejected);
  });

  it("still lets a live operator in on a managed cloud", async () => {
    await setCloud(true);

    expect(await mark()).toEqual({ domain: "airgap.example", verified: true });
  });
});
