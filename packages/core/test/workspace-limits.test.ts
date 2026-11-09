import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { setWorkspaceLimitsAsOperator } from "../src/operator/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The five workspace limits nothing could write (plan 0.7.0 B10).
 *
 * `storageQuotaBytes`, `exportInlineRowLimit`, `importRowLimit`,
 * `messageLogRetentionDays` and `agentRunCostCapUsd` were declared with
 * defaults and honoured when stored, but no screen and no action wrote them.
 * Akmal's choice on 9 November 2026: on a self-hosted instance an
 * administrator sets all five; on a cloud the storage quota and the agent cost
 * cap are the provider's levers and only an operator sets them.
 */

const OWNER = "limits-owner";
const OPERATOR = "limits-operator";
const GRANTER = "limits-granter";

let workspaceId: string;

const settings = async (): Promise<Record<string, unknown>> => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select settings from workspaces where id = $1",
    [workspaceId],
  );
  return rows[0].settings;
};

const asAdmin = async (input: Record<string, unknown>) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId: OWNER } },
    "settings.updateWorkspaceLimits",
    input as never,
  );
};

const makeCloud = async () => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into system_settings (key, value) values ('cloud.enabled', 'true'::jsonb) on conflict (key) do update set value = excluded.value",
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "delete from system_settings where key = 'cloud.enabled'",
  );
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4), ($5, $5, $6)",
    [
      OWNER,
      "limits-owner@example.com",
      OPERATOR,
      "limits-operator@example.com",
      GRANTER,
      "limits-granter@example.com",
    ],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: OWNER })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.admin.query(
    "delete from system_settings where key = 'cloud.enabled'",
  );
  await wb.close();
});

describe("on a self-hosted instance", () => {
  it("lets an administrator set all five, with one audit row", async () => {
    await asAdmin({
      storageQuotaBytes: 10 * 1024 ** 3,
      exportInlineRowLimit: 2000,
      importRowLimit: 500,
      messageLogRetentionDays: 30,
      agentRunCostCapUsd: 0.5,
    });
    expect(await settings()).toMatchObject({
      storageQuotaBytes: 10 * 1024 ** 3,
      exportInlineRowLimit: 2000,
      importRowLimit: 500,
      messageLogRetentionDays: 30,
      agentRunCostCapUsd: 0.5,
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from audit_events where workspace_id = $1 and action = 'settings.update_workspace_limits'",
      [workspaceId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("holds each to the registry's own rule", async () => {
    await expect(asAdmin({ messageLogRetentionDays: 3 })).rejects.toThrow();
    await expect(asAdmin({ importRowLimit: 0 })).rejects.toThrow();
    await expect(asAdmin({ agentRunCostCapUsd: -1 })).rejects.toThrow();
  });
});

describe("on a cloud", () => {
  it("still lets an administrator set the export, import and message-log limits", async () => {
    await makeCloud();
    await asAdmin({ importRowLimit: 250, messageLogRetentionDays: 0 });
    expect(await settings()).toMatchObject({
      importRowLimit: 250,
      messageLogRetentionDays: 0,
    });
  });

  it("refuses the storage quota and the agent cost cap to an administrator", async () => {
    await makeCloud();
    await expect(
      asAdmin({ storageQuotaBytes: 50 * 1024 ** 3 }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(asAdmin({ agentRunCostCapUsd: 100 })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("lets an operator set those two, recorded in the workspace's own audit log", async () => {
    await makeCloud();
    const wb = await workerDb();
    await wb.admin.query(
      "insert into instance_operators (user_id, granted_by_user_id) values ($1, $2)",
      [OPERATOR, GRANTER],
    );
    await setWorkspaceLimitsAsOperator(wb.appPool, {
      workspaceId,
      operatorUserId: OPERATOR,
      storageQuotaBytes: 20 * 1024 ** 3,
      agentRunCostCapUsd: 5,
      reason: "Pro plan, agreed on ticket 512.",
    });
    expect(await settings()).toMatchObject({
      storageQuotaBytes: 20 * 1024 ** 3,
      agentRunCostCapUsd: 5,
    });
    const { rows } = await wb.admin.query(
      "select actor_operator_user_id, payload from audit_events where workspace_id = $1 and action = 'settings.update_workspace_limits'",
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_operator_user_id).toBe(OPERATOR);
    expect(rows[0].payload).toMatchObject({ by: "operator" });
  });

  it("does not let an administrator undo the provider's limits with a reset", async () => {
    await makeCloud();
    const wb = await workerDb();
    await wb.admin.query(
      "insert into instance_operators (user_id, granted_by_user_id) values ($1, $2)",
      [OPERATOR, GRANTER],
    );
    await setWorkspaceLimitsAsOperator(wb.appPool, {
      workspaceId,
      operatorUserId: OPERATOR,
      agentRunCostCapUsd: 0.25,
      reason: "Free plan.",
    });
    await asAdmin({ importRowLimit: 250 });

    const reset = (input: Record<string, unknown>) =>
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: OWNER },
        },
        "settings.resetWorkspaceSettings",
        input as never,
      );
    await reset({ card: "limits" });
    // The administrator's own limit went back to its default; the
    // provider's stayed where the operator put it.
    expect(await settings()).toMatchObject({
      importRowLimit: 1000,
      agentRunCostCapUsd: 0.25,
    });
    await expect(reset({ key: "agentRunCostCapUsd" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses somebody who is not an operator, as not-found", async () => {
    await makeCloud();
    const wb = await workerDb();
    await expect(
      setWorkspaceLimitsAsOperator(wb.appPool, {
        workspaceId,
        operatorUserId: OWNER,
        storageQuotaBytes: 1,
        reason: "Trying.",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
