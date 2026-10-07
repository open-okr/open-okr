import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A member's leave, with a delegate, against a real database (METHOD.md §7.4,
 * P9-T19b-b, the Northwind year's gap G-2).
 *
 * "While they are away nobody nudges them, their reviews and acknowledgements
 * go to the delegate, and a check-in on a goal they champion is the
 * delegate's to post." Who stands in on a day is proved in `packages/method`;
 * this is the write, the read, the reviewer of record a check-in is stamped
 * with, and who the nudge run asks.
 */

const SARA = "leave-sara";

let workspaceId: string;
let saraId: string;
let meiId: string;
let priyaId: string;
let suspendedId: string;
let cycleId: string;

const call = async <T>(action: string, input: unknown): Promise<T> => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId: SARA } },
    action as never,
    input as never,
  )) as T;
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (on: string, days: number): string =>
  new Date(Date.parse(`${on}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const richText = (text: string) =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }) as never;

async function member(name: string, status = "active"): Promise<string> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'human', $3) returning id`,
    [workspaceId, name, status],
  );
  return rows[0]?.id as string;
}

async function createGoal(reviewerId: string | null): Promise<string> {
  return (
    await call<{ id: string }>("goals.create", {
      title: "Customers reach value in their first week",
      cycleId,
      level: "team",
      ownerKind: "workspace",
      championId: saraId,
      reviewerId,
    })
  ).id;
}

async function nudgesOn(goalOrCheckIn: string) {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    rule_key: string;
    recipient_member_id: string;
    sent_at: string | null;
    suppressed_reason: string | null;
  }>(
    `select rule_key, recipient_member_id, sent_at, suppressed_reason
       from nudges where workspace_id = $1 and subject_id = $2`,
    [workspaceId, goalOrCheckIn],
  );
  return rows;
}

async function runOn(on: string) {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, workspaceId, actor: { kind: "human", userId: SARA } },
    "nudges.run",
    { now: `${on}T12:00:00Z` },
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [SARA, "Sara", "leave-sara@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: SARA,
    name: "Sara",
  });
  workspaceId = provisioned.workspaceId;
  saraId = provisioned.memberId;
  meiId = await member("Mei");
  priyaId = await member("Priya");
  suspendedId = await member("Former", "suspended");
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("people.setLeave, people.setMemberLeave and people.leave", () => {
  it("marks a member's own leave with a delegate, reads it back, and audits it", async () => {
    await call("people.setLeave", {
      leave: [
        { startsOn: "2026-08-23", endsOn: "2026-08-27", delegateId: priyaId },
      ],
    });
    expect(await call("people.leave", { memberId: saraId })).toEqual([
      {
        startsOn: "2026-08-23",
        endsOn: "2026-08-27",
        delegateId: priyaId,
        delegateName: "Priya",
      },
    ]);
    const wb = await workerDb();
    const audit = await wb.admin.query<{ action: string }>(
      `select action from audit_events
        where workspace_id = $1 and action = 'people.setLeave'`,
      [workspaceId],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("lets an administrator mark somebody else's, audited as theirs", async () => {
    await call("people.setMemberLeave", {
      memberId: meiId,
      leave: [
        { startsOn: "2026-08-01", endsOn: "2026-10-16", delegateId: priyaId },
      ],
    });
    expect(
      (await call<unknown[]>("people.leave", { memberId: meiId })).length,
    ).toBe(1);
    const wb = await workerDb();
    const audit = await wb.admin.query<{ actor: string; target: string }>(
      `select actor_member_id as actor, target_id as target from audit_events
        where workspace_id = $1 and action = 'people.setMemberLeave'`,
      [workspaceId],
    );
    expect(audit.rows).toEqual([{ actor: saraId, target: meiId }]);
  });

  it("refuses a delegate who is the member, or not an active member", async () => {
    await expect(
      call("people.setLeave", {
        leave: [
          { startsOn: "2026-08-23", endsOn: "2026-08-27", delegateId: saraId },
        ],
      }),
    ).rejects.toThrow(/delegate who is not you/);
    await expect(
      call("people.setLeave", {
        leave: [
          {
            startsOn: "2026-08-23",
            endsOn: "2026-08-27",
            delegateId: suspendedId,
          },
        ],
      }),
    ).rejects.toThrow(/active member/);
  });

  it("refuses leave that ends before it starts, and replaces the list whole", async () => {
    await expect(
      call("people.setLeave", {
        leave: [
          { startsOn: "2026-08-27", endsOn: "2026-08-23", delegateId: priyaId },
        ],
      }),
    ).rejects.toThrow();
    await call("people.setLeave", {
      leave: [
        { startsOn: "2026-08-23", endsOn: "2026-08-27", delegateId: priyaId },
      ],
    });
    await call("people.setLeave", { leave: [] });
    expect(await call("people.leave", { memberId: saraId })).toEqual([]);
  });
});

describe("the delegate answers for the reviewer (acceptance)", () => {
  it("owes the acknowledgement on a check-in published while the reviewer is away, and Mei is not nudged", async () => {
    await call("people.setMemberLeave", {
      memberId: meiId,
      leave: [
        {
          startsOn: addDays(today(), -1),
          endsOn: addDays(today(), 10),
          delegateId: priyaId,
        },
      ],
    });
    const goalId = await createGoal(meiId);
    const draft = await call<{ id: string }>("goals.startCheckIn", { goalId });
    await call("goals.publishCheckIn", {
      id: draft.id,
      status: "on_track",
      confidence: 0.6,
      narrative: richText("Activation is moving."),
    });

    const wb = await workerDb();
    const stamped = await wb.admin.query<{ reviewer: string }>(
      "select reviewer_member_id as reviewer from check_ins where id = $1",
      [draft.id],
    );
    expect(stamped.rows[0]?.reviewer).toBe(priyaId);
    // The role stays Mei's: leave never moves one.
    const goal = await wb.admin.query<{ reviewer: string }>(
      "select reviewer_id as reviewer from goals where id = $1",
      [goalId],
    );
    expect(goal.rows[0]?.reviewer).toBe(meiId);

    // A day and three days on: the acknowledgement ladder asks Priya.
    await runOn(addDays(today(), 1));
    await runOn(addDays(today(), 3));
    const asked = await nudgesOn(draft.id);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.map((row) => row.recipient_member_id)).toContain(priyaId);
    expect(asked.map((row) => row.recipient_member_id)).not.toContain(meiId);
  });
});

describe("the delegate answers for the champion (NW-Q3-06)", () => {
  it("is nudged for the check-in on a goal the absent champion owns, and the champion is not", async () => {
    const goalId = await createGoal(null);
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ next: string }>(
      "select (next_check_in_at at time zone 'UTC')::date::text as next from goals where id = $1",
      [goalId],
    );
    const dueOn = rows[0]?.next as string;
    await call("people.setLeave", {
      leave: [
        {
          startsOn: addDays(dueOn, -2),
          endsOn: addDays(dueOn, 2),
          delegateId: priyaId,
        },
      ],
    });

    await runOn(dueOn);
    const asked = await nudgesOn(goalId);
    expect(asked.map((row) => row.rule_key)).toContain("checkin.due");
    expect(asked.map((row) => row.recipient_member_id)).toEqual([priyaId]);
  });

  it("holds the nudge, with the reason leave, when everybody in the chain is away", async () => {
    const goalId = await createGoal(null);
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ next: string }>(
      "select (next_check_in_at at time zone 'UTC')::date::text as next from goals where id = $1",
      [goalId],
    );
    const dueOn = rows[0]?.next as string;
    const span = { startsOn: addDays(dueOn, -2), endsOn: addDays(dueOn, 2) };
    await call("people.setLeave", {
      leave: [{ ...span, delegateId: priyaId }],
    });
    await call("people.setMemberLeave", {
      memberId: priyaId,
      leave: [{ ...span, delegateId: saraId }],
    });

    await runOn(dueOn);
    const held = await nudgesOn(goalId);
    expect(held.length).toBeGreaterThan(0);
    for (const row of held) {
      expect(row.recipient_member_id).toBe(saraId);
      expect(row.suppressed_reason).toBe("leave");
      expect(row.sent_at).toBeNull();
    }
  });
});
