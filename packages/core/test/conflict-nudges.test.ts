import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import type { AgentDrafter } from "../src/agents/drafter.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * `quality.conflict`, to both champions (docs/design/agents.md §3.2,
 * AI-NATIVE-PLAN §6.4, plan 0.7.0 A5, approved by Akmal on 9 November 2026).
 *
 * The semantic sweep writes a conflict finding when two goals double-count or
 * oppose each other. Until A5 nothing turned it into a message. It is the one
 * trigger that needs the provider, so it fires only from a run whose semantic
 * review ran: with AI off, a finding kept from an earlier run says nothing.
 */

const OWNER = "conflict-owner";
const SECOND = "conflict-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let secondMemberId: string;
let first: string;
let second: string;

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

const goal = async (title: string, championId: string) =>
  (
    await call<{ id: string }>("goals.create", {
      title,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId,
    })
  ).id;

/**
 * A drafter whose review finds that the first goal and the second conflict,
 * shaped as `champion-drafting.test.ts` shapes its own. It drafts nothing else
 * and spends nothing.
 */
const reviewing = (): AgentDrafter => ({
  async draftCheckIn() {
    return null;
  },
  async refineRecoveryTitle() {
    return null;
  },
  async reviewAlignment() {
    return [
      {
        kind: "conflict",
        subjectIndex: 0,
        targetIndex: 1,
        severity: "medium",
        reason:
          "Both claim the same rise in weekly active teams, so one of them counts the other's work.",
      },
    ];
  },
  spentUsd: () => 0,
});

const conflictNudges = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    subject_id: string;
    recipient_member_id: string;
  }>(
    `select subject_id, recipient_member_id from nudges
      where workspace_id = $1 and rule_key = 'quality.conflict'
      order by recipient_member_id`,
    [workspaceId],
  );
  return rows;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2), ($3, 'Second', $4)",
    [OWNER, `${OWNER}@example.com`, SECOND, `${SECOND}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  // No member factory exists; the divergence test makes its second member
  // the same way, then puts them in the space their goal belongs to.
  secondMemberId = (
    await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, 'Second', 'active') returning id`,
      [workspaceId, SECOND],
    )
  ).rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId,
    memberId: secondMemberId,
    role: "member",
  });
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  first = await goal("Mid-market teams reach for us first", ownerMemberId);
  second = await goal(
    "Grow weekly active teams in the mid-market",
    secondMemberId,
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a conflict between two goals", () => {
  it("tells each champion, about their own goal, citing quality.conflict", async () => {
    const wb = await workerDb();
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human" as const, userId: OWNER },
        drafter: reviewing(),
      } as never,
      "agents.runCoach" as never,
      {} as never,
    );

    const findings = await wb.admin.query(
      `select subject_goal_id, target_goal_id from alignment_findings
        where workspace_id = $1 and kind = 'conflict' and deleted_at is null`,
      [workspaceId],
    );
    expect(findings.rows).toHaveLength(1);

    const nudged = await conflictNudges();
    expect(nudged).toEqual(
      [
        { subject_id: first, recipient_member_id: ownerMemberId },
        { subject_id: second, recipient_member_id: secondMemberId },
      ].sort((a, b) =>
        a.recipient_member_id.localeCompare(b.recipient_member_id),
      ),
    );
  });

  it("says nothing with AI off, even about a finding an earlier run kept", async () => {
    const wb = await workerDb();
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human" as const, userId: OWNER },
        drafter: reviewing(),
      } as never,
      "agents.runCoach" as never,
      {} as never,
    );
    await wb.admin.query("delete from nudges where workspace_id = $1", [
      workspaceId,
    ]);

    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human" as const, userId: OWNER },
      },
      "agents.runCoach" as never,
      {} as never,
    );

    // The finding stays, as the sweep promises; the message does not.
    const kept = await wb.admin.query(
      `select 1 from alignment_findings
        where workspace_id = $1 and kind = 'conflict' and state = 'open' and deleted_at is null`,
      [workspaceId],
    );
    expect(kept.rows).toHaveLength(1);
    expect(await conflictNudges()).toEqual([]);
  });
});
