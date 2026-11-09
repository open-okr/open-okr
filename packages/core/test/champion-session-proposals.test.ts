import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The Champion opens and skips weekly sessions, as proposals (plan 0.7.0 A13,
 * docs/design/sessions.md §2.1).
 *
 * Approved on 9 November 2026 as proposals into the review queue: the
 * Champion never moves a session itself. `session.open` carries a proposal to
 * open it and `session.missed` one to skip it, the facilitator decides each in
 * the review inbox, and whichever way the session leaves `scheduled` settles
 * the other.
 */

const OWNER = "session-proposal-owner";
const SECOND = "session-proposal-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const call = async (name: string, input: unknown, userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    name as never,
    input as never,
  );
};

const runWeekly = (at: Date) =>
  call("agents.runChampion", { now: at.toISOString(), cadence: "weekly" });

const schedule = async (
  scheduledFor: string,
  kind: "weekly" | "monthly" = "weekly",
) =>
  (await call("sessions.create", {
    spaceId,
    cycleId,
    kind,
    title: kind === "weekly" ? "Weekly check-in" : "Monthly review",
    scheduledFor,
    facilitatorId: ownerMemberId,
  })) as { id: string };

/** Every proposal on a session, oldest first. */
const proposals = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    action: string;
    payload: Record<string, unknown>;
    status: string;
    ai_generated: boolean;
    subject_type: string | null;
    subject_id: string | null;
    decided_by_member_id: string | null;
  }>(
    `select id, action, payload, status, ai_generated, subject_type,
            subject_id, decided_by_member_id
       from proposed_changes
      where workspace_id = $1 and subject_type = 'session'
      order by created_at`,
    [workspaceId],
  );
  return rows;
};

const stateOf = async (sessionId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ state: string }>(
    "select state from okr_sessions where id = $1",
    [sessionId],
  );
  return rows[0]?.state;
};

/** The session nudges, with the proposal each one carries. */
const sessionNudges = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    rule_key: string;
    recipient_member_id: string;
    proposal_id: string | null;
  }>(
    `select rule_key, recipient_member_id, proposal_id
       from nudges
      where workspace_id = $1 and subject_type = 'session'
      order by created_at`,
    [workspaceId],
  );
  return rows;
};

const inboxProposals = async (userId = OWNER) =>
  (
    (await call("review.inbox", {}, userId)) as {
      obligations: {
        kind: string;
        title: string;
        proposal: { id: string; action: string } | null;
      }[];
    }
  ).obligations.filter((row) => row.kind === "proposal");

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Proposal Owner",
      "session-proposal-owner@example.com",
      SECOND,
      "Proposal Second",
      "session-proposal-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Proposal Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as {
      id: string;
    }
  ).id;

  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Proposal Second', 'active')
     returning id`,
    [workspaceId, SECOND],
  );
  await call("spaces.addMember", {
    spaceId,
    memberId: second.rows[0]?.id,
    role: "member",
  });
  // Quiet hours off, so a delivery assertion does not depend on the hour.
  await wb.admin.query(
    "update workspace_members set quiet_hours = null where workspace_id = $1",
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("at the scheduled hour, the Champion proposes opening the session", () => {
  it("attaches one pending proposal to the facilitator's session.open, and moves nothing", async () => {
    const session = await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-07T09:30:00Z"));

    const found = await proposals();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      action: "sessions.open",
      payload: { id: session.id },
      status: "pending",
      ai_generated: false,
      subject_id: session.id,
    });
    const nudge = (await sessionNudges()).find(
      (row) => row.rule_key === "session.open",
    );
    expect(nudge?.recipient_member_id).toBe(ownerMemberId);
    expect(nudge?.proposal_id).toBe(found[0]?.id);
    // The Champion proposes; it never opens.
    expect(await stateOf(session.id)).toBe("scheduled");
  });

  it("proposes nothing the day before, and only once while the window is open", async () => {
    const session = await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-06T15:00:00Z"));
    expect(await proposals()).toEqual([]);

    await runWeekly(new Date("2026-09-07T09:30:00Z"));
    await runWeekly(new Date("2026-09-07T10:30:00Z"));
    const found = await proposals();
    expect(found).toHaveLength(1);
    expect(found[0]?.subject_id).toBe(session.id);
  });

  it("lists it in the facilitator's review inbox, and nobody else's", async () => {
    await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-07T09:30:00Z"));

    const mine = await inboxProposals();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.title).toBe('Open the session "Weekly check-in"');
    expect(mine[0]?.proposal?.action).toBe("sessions.open");
    expect(await inboxProposals(SECOND)).toEqual([]);
  });

  it("opens the session as the facilitator when they apply it", async () => {
    const session = await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-07T09:30:00Z"));
    const [proposal] = await proposals();

    await call("proposals.apply", { id: proposal?.id });

    expect(await stateOf(session.id)).toBe("running");
    const [decided] = await proposals();
    expect(decided).toMatchObject({
      status: "applied",
      decided_by_member_id: ownerMemberId,
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ actor_member_id: string }>(
      `select actor_member_id from audit_events
        where workspace_id = $1 and action = 'sessions.open'`,
      [workspaceId],
    );
    expect(rows.map((row) => row.actor_member_id)).toEqual([ownerMemberId]);
    expect(await inboxProposals()).toEqual([]);
  });

  it("is not offered again once the facilitator dismissed it", async () => {
    await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-07T09:30:00Z"));
    const [proposal] = await proposals();
    await call("proposals.dismiss", { id: proposal?.id });

    await runWeekly(new Date("2026-09-07T11:30:00Z"));
    const found = await proposals();
    expect(found).toHaveLength(1);
    expect(found[0]?.status).toBe("dismissed");
  });

  it("is settled when the facilitator opens the session by hand", async () => {
    const session = await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-07T09:30:00Z"));

    await call("sessions.open", { id: session.id });

    const [settled] = await proposals();
    expect(settled).toMatchObject({
      status: "dismissed",
      decided_by_member_id: ownerMemberId,
    });
    expect(await inboxProposals()).toEqual([]);
  });

  it("proposes nothing for a monthly review, which still gets its message", async () => {
    await schedule("2026-09-07T09:00:00Z", "monthly");
    await runWeekly(new Date("2026-09-07T09:30:00Z"));
    expect(await proposals()).toEqual([]);
    expect((await sessionNudges()).map((row) => row.rule_key)).toEqual([
      "session.open",
    ]);
  });
});

describe("the day after a session nobody opened, the Champion proposes skipping it", () => {
  it("attaches a pending skip proposal to session.missed, beside the open one", async () => {
    const session = await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-07T09:30:00Z"));
    await runWeekly(new Date("2026-09-08T10:30:00Z"));

    const found = await proposals();
    expect(found.map((row) => [row.action, row.status])).toEqual([
      ["sessions.open", "pending"],
      ["sessions.skip", "pending"],
    ]);
    const missed = (await sessionNudges()).find(
      (row) => row.rule_key === "session.missed",
    );
    expect(missed?.proposal_id).toBe(found[1]?.id);
    expect(await stateOf(session.id)).toBe("scheduled");
  });

  it("skips the session when applied, and settles the open proposal", async () => {
    const session = await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-07T09:30:00Z"));
    await runWeekly(new Date("2026-09-08T10:30:00Z"));
    const skip = (await proposals()).find(
      (row) => row.action === "sessions.skip",
    );

    await call("proposals.apply", { id: skip?.id });

    expect(await stateOf(session.id)).toBe("skipped");
    const decided = await proposals();
    expect(
      decided.map((row) => [row.action, row.status, row.decided_by_member_id]),
    ).toEqual([
      ["sessions.open", "dismissed", ownerMemberId],
      ["sessions.skip", "applied", ownerMemberId],
    ]);
    expect(await inboxProposals()).toEqual([]);
  });

  it("proposes nothing two days on", async () => {
    await schedule("2026-09-07T09:00:00Z");
    await runWeekly(new Date("2026-09-09T10:30:00Z"));
    expect(await proposals()).toEqual([]);
  });
});

describe("what the Champion's own settings decide", () => {
  it("commits nothing in sandbox mode", async () => {
    const session = await schedule("2026-09-07T09:00:00Z");
    const wb = await workerDb();
    await wb.admin.query(
      "update agents set autonomy = 'sandbox' where workspace_id = $1 and kind = 'champion'",
      [workspaceId],
    );

    const run = (await runWeekly(new Date("2026-09-07T09:30:00Z"))) as {
      proposed: number;
    };

    // Counted, and discarded with everything else the run would have written.
    expect(run.proposed).toBe(1);
    expect(await proposals()).toEqual([]);
    expect(await sessionNudges()).toEqual([]);
    expect(await stateOf(session.id)).toBe("scheduled");
  });

  it("proposes nothing about a session in a space it is not bound to", async () => {
    await schedule("2026-09-07T09:00:00Z");
    const wb = await workerDb();
    await wb.admin.query(
      `update access_bindings b set deleted_at = now()
         from access_groups g, agents a
        where g.id = b.group_id and g.member_id = a.member_id
          and a.workspace_id = $1 and a.kind = 'champion'`,
      [workspaceId],
    );

    await runWeekly(new Date("2026-09-07T09:30:00Z"));
    expect(await proposals()).toEqual([]);
  });
});
