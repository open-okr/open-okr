import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A quick confidence update, outside a check-in (docs/design/okr-writing.md
 * §4.2, plan 0.7.0 O4).
 *
 * Confidence was written only by a check-in or by a champion confirming it
 * in a weekly session. The list's confidence cell now writes it on its own,
 * through `goals.updateConfidence`, and the change is in the goal's feed.
 */

const OWNER = "confidence-owner";
let workspaceId: string;
let goalId: string;
let keyResultId: string;

const call = async <T>(name: string, input: unknown): Promise<T> =>
  (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  )) as T;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  const spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]
    ?.id as string;
  const cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  goalId = (
    await call<{ id: string }>("goals.create", {
      title: "Mid-market teams reach for us first",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: provisioned.memberId,
    })
  ).id;
  keyResultId = (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Raise weekly active teams from 120 to 300 by 31 March",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 120,
      targetValue: 300,
      unit: "teams",
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a quick confidence update", () => {
  it("sets the key result's confidence and says so in the goal's feed", async () => {
    const result = await call<{ id: string; confidence: number }>(
      "goals.updateConfidence",
      { id: keyResultId, confidence: 0.7 },
    );
    expect(result).toEqual({ id: keyResultId, confidence: 0.7 });

    const wb = await workerDb();
    const stored = await wb.admin.query(
      "select confidence::float as confidence from key_results where id = $1",
      [keyResultId],
    );
    expect(stored.rows[0].confidence).toBe(0.7);

    const activity = await wb.admin.query(
      `select kind, subject_type, subject_id, payload from activities
        where kind = 'key_result.confidence_updated'`,
    );
    expect(activity.rows).toEqual([
      {
        kind: "key_result.confidence_updated",
        subject_type: "goal",
        subject_id: goalId,
        payload: { keyResultId, from: null, to: 0.7 },
      },
    ]);
    const audit = await wb.admin.query(
      "select target_id from audit_events where action = 'goals.updateConfidence'",
    );
    expect(audit.rows).toEqual([{ target_id: keyResultId }]);
  });

  it("records where it moved from", async () => {
    await call("goals.updateConfidence", { id: keyResultId, confidence: 0.7 });
    await call("goals.updateConfidence", { id: keyResultId, confidence: 0.4 });

    const wb = await workerDb();
    const last = await wb.admin.query(
      `select payload from activities where kind = 'key_result.confidence_updated'
        order by at desc limit 1`,
    );
    expect(last.rows[0].payload).toEqual({ keyResultId, from: 0.7, to: 0.4 });
  });

  it("answers not found for a key result that does not exist", async () => {
    const refused = await call("goals.updateConfidence", {
      id: "00000000-0000-4000-8000-000000000000",
      confidence: 0.5,
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OperationError);
    expect((refused as OperationError).code).toBe("not_found");
  });

  it("refuses a confidence outside nought to one", async () => {
    await expect(
      call("goals.updateConfidence", { id: keyResultId, confidence: 7 }),
    ).rejects.toThrow();
  });
});
