import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The kind of promise an objective makes (METHOD.md §2.8, P9-T11b-a).
 *
 * A new objective is aspirational unless somebody says otherwise, or the
 * workspace uses committed OKRs only. A change of kind is open until the
 * close, refused for a kind the workspace has turned off, and recorded in the
 * activity with its reason, because that is the record the close reads.
 */

const OWNER = "kind-owner";
const OUTSIDER = "kind-outsider";

let workspaceId: string;
let ownerMemberId: string;
let quarterId: string;

async function call<T>(
  userId: string,
  action: string,
  input: unknown,
): Promise<T> {
  return (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    action as never,
    input as never,
  )) as T;
}

async function objective(extra: Record<string, unknown> = {}): Promise<string> {
  const goal = await call<{ id: string }>(OWNER, "goals.create", {
    title: "Make onboarding something a team finishes in one sitting",
    cycleId: quarterId,
    level: "team",
    ownerKind: "workspace",
    championId: ownerMemberId,
    ...extra,
  });
  return goal.id;
}

async function kindOf(goalId: string): Promise<string> {
  const goal = await call<{ kind: string }>(OWNER, "goals.read", {
    id: goalId,
  });
  return goal.kind;
}

async function kindChanges(goalId: string) {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    payload: { from: string; to: string; reason: string | null };
  }>(
    "select payload from activities where subject_id = $1 and kind = 'goal.kind_changed' order by at",
    [goalId],
  );
  return rows.map((row) => row.payload);
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Priya Owner",
      `${OWNER}@example.com`,
      OUTSIDER,
      "Omar Outsider",
      `${OUTSIDER}@example.com`,
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Priya Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  // A member with no role and no binding: every objective is hidden from them.
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'Omar Outsider', 'human', 'active')`,
    [workspaceId, OUTSIDER],
  );

  const year = new Date().getUTCFullYear() + 2;
  quarterId = (
    await call<{ id: string }>(OWNER, "cycles.create", {
      on: `${year}-05-15`,
      mode: "quarterly",
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a new objective's kind", () => {
  it("is aspirational when nobody says otherwise (decision D2)", async () => {
    expect(await kindOf(await objective())).toBe("aspirational");
  });

  it("is what the writer chose", async () => {
    expect(await kindOf(await objective({ kind: "committed" }))).toBe(
      "committed",
    );
  });

  it("is committed by default where the workspace uses committed OKRs only", async () => {
    await call(OWNER, "practice.update", {
      overrides: { "okr.kinds": "committedOnly" },
    });
    expect(await kindOf(await objective())).toBe("committed");
    await expect(objective({ kind: "aspirational" })).rejects.toThrow(
      /committed OKRs only/,
    );
  });
});

describe("goals.setKind", () => {
  it("changes the kind and records the change and its reason in the activity", async () => {
    const goalId = await objective();
    const result = await call<{
      goal: { kind: string };
      changed: boolean;
    }>(OWNER, "goals.setKind", {
      id: goalId,
      kind: "committed",
      reason: "The board made it a promise to the customer.",
    });
    expect(result.changed).toBe(true);
    // The node the cache merges, so the list, the drawer and the diagram
    // show the new kind from the write's own answer.
    expect(result.goal.kind).toBe("committed");
    expect(await kindOf(goalId)).toBe("committed");
    expect(await kindChanges(goalId)).toEqual([
      {
        from: "aspirational",
        to: "committed",
        reason: "The board made it a promise to the customer.",
      },
    ]);
  });

  it("records a change with no reason, because the reason is asked for and not required", async () => {
    const goalId = await objective({ kind: "committed" });
    await call(OWNER, "goals.setKind", { id: goalId, kind: "aspirational" });
    expect(await kindChanges(goalId)).toEqual([
      { from: "committed", to: "aspirational", reason: null },
    ]);
  });

  it("reports nothing changed when the objective is already that kind", async () => {
    const goalId = await objective();
    const result = await call<{ changed: boolean }>(OWNER, "goals.setKind", {
      id: goalId,
      kind: "aspirational",
    });
    expect(result.changed).toBe(false);
  });

  it("refuses a kind the workspace has turned off, citing the setting", async () => {
    const goalId = await objective();
    await call(OWNER, "practice.update", {
      overrides: { "okr.kinds": "aspirationalOnly" },
    });
    await expect(
      call(OWNER, "goals.setKind", { id: goalId, kind: "committed" }),
    ).rejects.toThrow(/aspirational OKRs only/);
    expect(await kindOf(goalId)).toBe("aspirational");
  });

  it("refuses a closed objective, which keeps the kind it was closed as", async () => {
    const goalId = await objective({ kind: "committed" });
    await call(OWNER, "goals.close", {
      id: goalId,
      successStatus: "missed",
      closeDecision: "abandon",
      closeReason: "The market moved.",
      retrospectiveBody: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Missed." }] },
        ],
      },
    });
    await expect(
      call(OWNER, "goals.setKind", { id: goalId, kind: "aspirational" }),
    ).rejects.toThrow(/closed objective keeps the kind/);
  });

  it("is not found for a member who cannot see the objective", async () => {
    const goalId = await objective();
    await expect(
      call(OUTSIDER, "goals.setKind", { id: goalId, kind: "committed" }),
    ).rejects.toThrow(/not found|No such/i);
    expect(await kindOf(goalId)).toBe("aspirational");
  });
});
