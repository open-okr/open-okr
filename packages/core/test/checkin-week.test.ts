import { withWorkspace } from "@openokr/db";
import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { nudgeDraft } from "../src/nudges/message.ts";
import { dueCheckInNudges } from "../src/nudges/service.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The week's check-ins in one message (OKRGoal UX review, backlog 8: "Monday
 * digest: 2 KRs, 3 minutes. One deep link opens a prefilled check-in").
 * A champion with two or more goals due on the anchor day hears once, and
 * the link opens the check-in walker, which holds them all.
 */

const OWNER = "week-owner";
let workspaceId: string;
let memberId: string;
let cycleId: string;

const as = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', 'week-owner@example.com')",
    [OWNER],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  const member = await wb.admin.query<{ id: string }>(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  memberId = member.rows[0]?.id as string;
  const cycle = await callAction(
    { pool: wb.appPool, ...as() },
    "cycles.current",
    {
      mode: "quarterly",
    },
  );
  cycleId = cycle?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

async function goalDueToday(title: string): Promise<string> {
  const wb = await workerDb();
  const goal = (await callAction(
    { pool: wb.appPool, ...as() },
    "goals.create",
    {
      cycleId,
      level: "company",
      ownerKind: "workspace",
      title,
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
    },
  )) as { id: string };
  await wb.admin.query(
    "update goals set next_check_in_at = date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '23 hours 59 minutes' where id = $1",
    [goal.id],
  );
  return goal.id;
}

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

describe("the week's check-ins", () => {
  it("is one message for two goals due today, instead of one each", async () => {
    await goalDueToday("Make onboarding the reason customers stay");
    await goalDueToday("Halve the reopened tickets");
    const nudges = await due();
    expect(nudges.map((nudge) => nudge.ruleKey)).toEqual(["checkin.week"]);
    expect(nudges[0]).toMatchObject({
      subjectType: "member",
      subjectId: memberId,
      recipientMemberId: memberId,
    });
  });

  it("leaves a single goal due today as its own reminder", async () => {
    const goalId = await goalDueToday("Halve the reopened tickets");
    const nudges = await due();
    expect(nudges.map((nudge) => [nudge.ruleKey, nudge.subjectId])).toEqual([
      ["checkin.due", goalId],
    ]);
  });

  it("opens the check-in walker", async () => {
    const wb = await workerDb();
    const draft = await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      nudgeDraft(tx, {
        workspaceId,
        ruleKey: "checkin.week",
        subjectType: "member",
        subjectId: memberId,
        provider: "email",
        baseUrl: "https://okr.example.com",
      }),
    );
    expect(JSON.stringify(draft)).toContain("https://okr.example.com/check-in");
  });
});
