import { withWorkspace } from "@openokr/db";
import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { dueCheckInNudges } from "../src/nudges/service.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The peer step in the check-in ladder (METHOD.md §2.5, §11, §12.1; OKRGoal
 * UX review, backlog 15): once grace is exceeded, one teammate is asked to
 * offer a hand before the reviewer and the coordinator hear.
 */

const OWNER = "peer-owner";
const LATE = "peer-late";
const PEER = "peer-peer";
const IDLE = "peer-idle";

let workspaceId: string;
const members: Record<string, string> = {};
let lateGoalId: string;

const as = (userId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  const people = [OWNER, LATE, PEER, IDLE];
  await wb.admin.query(
    `insert into users (id, name, email) select u, u, u || '@example.com'
       from unnest($1::text[]) as u`,
    [people],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: OWNER })
  ).workspaceId;
  for (const user of people.slice(1)) {
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, $2, 'active')`,
      [workspaceId, user],
    );
  }
  const rows = await wb.admin.query<{ id: string; user_id: string }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  for (const row of rows.rows) {
    members[row.user_id] = row.id;
  }

  const space = await callAction(
    { pool: wb.appPool, ...as(OWNER) },
    "spaces.create",
    { name: "Support" },
  );
  for (const user of [LATE, PEER, IDLE]) {
    await callAction({ pool: wb.appPool, ...as(OWNER) }, "spaces.addMember", {
      spaceId: space.id,
      memberId: members[user] as string,
      role: "member",
    });
  }
  const cycle = await callAction(
    { pool: wb.appPool, ...as(OWNER) },
    "cycles.current",
    { mode: "quarterly" },
  );
  const goal = (title: string, champion: string) =>
    callAction({ pool: wb.appPool, ...as(OWNER) }, "goals.create", {
      cycleId: cycle?.id as string,
      level: "team",
      spaceId: space.id,
      ownerKind: "space",
      title,
      championId: members[champion] as string,
      reviewerId: members[OWNER] as string,
      weight: 1,
    }) as Promise<{ id: string }>;
  lateGoalId = (await goal("Answer every ticket within the hour", LATE)).id;
  const onTime = (await goal("Halve the reopened tickets", PEER)).id;

  const grace = canonThresholds()["cadence.stalenessGraceDays"];
  await wb.admin.query(
    "update goals set next_check_in_at = now() - make_interval(days => $2) where id = $1",
    [lateGoalId, grace + 1],
  );
  await wb.admin.query(
    "update goals set next_check_in_at = now() + interval '3 days' where id = $1",
    [onTime],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const due = async () => {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
    dueCheckInNudges(tx, {
      workspaceId,
      now: new Date(),
      timeZone: "UTC",
      thresholds: canonThresholds(),
    }),
  );
};

const onLateGoal = async () =>
  (await due()).filter((nudge) => nudge.subjectId === lateGoalId);

describe("the peer step", () => {
  it("asks the reviewer, not a peer, while the workspace leaves it off", async () => {
    const nudges = await onLateGoal();
    expect(nudges.map((nudge) => nudge.recipientMemberId).sort()).toEqual(
      [members[LATE], members[OWNER]].sort(),
    );
    expect(nudges.some((nudge) => nudge.ruleKey === "checkin.peer")).toBe(
      false,
    );
  });

  it("asks one teammate who is up to date, and not the reviewer yet", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...as(OWNER) }, "practice.update", {
      overrides: { "escalation.peerStep": "on" },
    });
    const nudges = await onLateGoal();
    const peer = nudges.filter((nudge) => nudge.ruleKey === "checkin.peer");
    // IDLE champions nothing this cycle, so they are not a peer of a champion.
    expect(peer.map((nudge) => nudge.recipientMemberId)).toEqual([
      members[PEER],
    ]);
    expect(nudges.map((nudge) => nudge.recipientMemberId)).not.toContain(
      members[OWNER],
    );
  });

  it("skips the step when nobody qualifies", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...as(OWNER) }, "practice.update", {
      overrides: { "escalation.peerStep": "on" },
    });
    // The only candidate falls behind too: a late peer is not asked to help.
    await wb.admin.query(
      "update goals set next_check_in_at = now() - interval '2 days' where champion_id = $1",
      [members[PEER]],
    );
    const nudges = await onLateGoal();
    expect(nudges.some((nudge) => nudge.ruleKey === "checkin.peer")).toBe(
      false,
    );
    expect(nudges.map((nudge) => nudge.recipientMemberId)).toEqual([
      members[LATE],
    ]);
  });
});
