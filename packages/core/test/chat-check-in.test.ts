import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { submitCheckIn } from "../src/channels/check-in-flow.ts";
import { routeCommand } from "../src/channels/router.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The conversational check-in (design §8, P5-T06b).
 *
 * The acceptance criterion is the last test in "the whole thing": a check-in
 * completed from chat is the record the browser produces, and the cadence and
 * the reviewer's obligation move with it.
 *
 * The property that runs through everything else is §8.1's: **nothing partial
 * is ever stored as a check-in**. A conversation that collects two answers and
 * stops leaves no draft anybody has to find, and the goal is still due.
 */

const CHAMPION = "flow-champion";
const REVIEWER = "flow-reviewer";

let workspaceId: string;
let goalId: string;
let championMemberId: string;
let reviewerMemberId: string;
let keyResultIds: string[];

const asChampion = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: CHAMPION },
});

/** One message from the champion, at a stated moment. */
const say = async (text: string, at = new Date("2026-08-27T09:00:00.000Z")) => {
  const wb = await workerDb();
  return routeCommand({
    pool: wb.appPool,
    workspaceId,
    provider: "slack",
    memberId: championMemberId,
    userId: CHAMPION,
    text,
    now: at,
  });
};

async function conversationRows() {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select command, awaiting, collected, expires_at from channel_conversations where workspace_id = $1",
    [workspaceId],
  );
  return rows.rows as Array<{
    command: string;
    awaiting: string;
    collected: Record<string, unknown>;
    expires_at: Date;
  }>;
}

async function checkInRows() {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    `select status, confidence, published_at, narrative
       from check_ins where workspace_id = $1 order by created_at`,
    [workspaceId],
  );
  return rows.rows as Array<{
    status: string | null;
    confidence: string | number | null;
    published_at: Date | null;
    narrative: unknown;
  }>;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      CHAMPION,
      "Champion",
      "flow-champion@example.com",
      REVIEWER,
      "Reviewer",
      "flow-reviewer@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: CHAMPION,
    name: "Champion",
  });
  workspaceId = provisioned.workspaceId;

  const champion = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, CHAMPION],
  );
  championMemberId = champion.rows[0].id as string;

  const reviewer = await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Reviewer', 'active') returning id`,
    [workspaceId, REVIEWER],
  );
  reviewerMemberId = reviewer.rows[0].id as string;

  const cycle = await callAction(
    { pool: wb.appPool, ...asChampion() },
    "cycles.current",
    { mode: "quarterly" },
  );
  const goal = (await callAction(
    { pool: wb.appPool, ...asChampion() },
    "goals.create",
    {
      cycleId: cycle?.id as string,
      level: "company",
      title: "Become the preferred platform for mid-market teams",
      ownerKind: "workspace",
      championId: championMemberId,
      reviewerId: reviewerMemberId,
      weight: 1,
    },
  )) as { id: string };
  goalId = goal.id;

  await callAction(
    { pool: wb.appPool, ...asChampion() },
    "goals.addKeyResult",
    {
      goalId,
      title: "Lift enterprise net revenue retention to 115%",
      unit: "%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 100,
      targetValue: 115,
      weight: 1,
    },
  );

  const krs = await wb.admin.query(
    "select id from key_results where goal_id = $1 order by created_at",
    [goalId],
  );
  keyResultIds = krs.rows.map((row) => row.id as string);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("starting one", () => {
  it("asks the first question and writes a conversation row", async () => {
    const reply = await say(`checkin ${goalId}`);
    expect(reply.text).toMatch(/How is it going/);

    const rows = await conversationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toBe("checkin");
    expect(rows[0]?.awaiting).toBe("status");
    // Nothing collected yet, and no check-in published.
    expect(rows[0]?.collected).toEqual({});
    expect(
      (await checkInRows()).every((row) => row.published_at === null),
    ).toBe(true);
  });

  it("refuses before asking anything, when there is nothing to check in", async () => {
    // A goal that does not exist, which is the same answer as one the caller
    // may not see (§8.1 layer 2). The reviewer is not the example here: the
    // reviewer of record holds edit on the goal they review, so they may check
    // it in, which `check-ins.ts` says in its own comment.
    const reply = await say("checkin 00000000-0000-4000-8000-000000000000");

    // Asking three questions and then refusing would waste somebody's time and
    // teach them the product does not know its own rules.
    expect(reply.text).not.toMatch(/How is it going/);
    expect(await conversationRows()).toEqual([]);
  });
});

describe("answering", () => {
  it("takes the answers in §3.2's order and asks the next one each time", async () => {
    await say(`checkin ${goalId}`);

    const afterStatus = await say("on track");
    expect(afterStatus.text).toMatch(/confident/);
    expect((await conversationRows())[0]?.awaiting).toBe("confidence");

    const afterConfidence = await say("8");
    expect(afterConfidence.text).toMatch(/One line on why/);

    const afterNarrative = await say("Two enterprise renewals landed early.");
    // The key result's own question comes last, which is why §3.2 puts the
    // values there: a member who stops here has still said what matters most.
    expect(afterNarrative.text).toContain(
      "Lift enterprise net revenue retention",
    );
  });

  it("reads 0 to 10 from a person and stores the 0 to 1 the action takes", async () => {
    await say(`checkin ${goalId}`);
    await say("on track");
    await say("8");

    const collected = (await conversationRows())[0]?.collected;
    expect(collected?.confidence).toBe(0.8);
  });

  it("accepts a status a person would actually type", async () => {
    for (const answer of ["on track", "On Track", "on_track", "off-track"]) {
      // `checkin` restarts the conversation rather than being read as an
      // answer to the last question, which is what makes this loop possible.
      await say(`checkin ${goalId}`);
      const reply = await say(answer);
      expect(reply.text, `"${answer}" should be an answer`).toMatch(
        /confident/,
      );
    }
  });

  it("restarts rather than being abandoned when a member types the command again", async () => {
    await say(`checkin ${goalId}`);
    await say("on track");

    const again = await say(`checkin ${goalId}`);
    expect(again.text).toMatch(/How is it going/);

    // Back at the first question, with nothing carried over from the abandoned
    // attempt: a half-answered conversation is not a head start.
    const rows = await conversationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.awaiting).toBe("status");
    expect(rows[0]?.collected).toEqual({});
  });

  it("lets a member skip a value they cannot look up", async () => {
    await say(`checkin ${goalId}`);
    await say("caution");
    await say("5");
    await say("Waiting on two renewals.");
    const done = await say("skip");

    expect(done.text).toMatch(/Checked in/);

    // Published, and the key result's own value did not move: skipping is an
    // answer, so the check-in exists and says nothing it was not told.
    const wb = await workerDb();
    const kr = await wb.admin.query(
      "select current_value from key_results where id = $1",
      [keyResultIds[0]],
    );
    expect(Number(kr.rows[0].current_value)).toBe(100);
  });
});

describe("nothing partial is ever stored", () => {
  it("abandons on a reply that is not an answer, and saves nothing", async () => {
    await say(`checkin ${goalId}`);
    await say("on track");

    const reply = await say("actually never mind");
    expect(reply.text).toMatch(/stopped/);
    expect(reply.text).toMatch(/Nothing was saved/);

    // The conversation is gone and no check-in was published.
    expect(await conversationRows()).toEqual([]);
    expect(
      (await checkInRows()).every((row) => row.published_at === null),
    ).toBe(true);
  });

  it("leaves the goal still due after an abandoned conversation", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query(
      "select next_check_in_at from goals where id = $1",
      [goalId],
    );

    await say(`checkin ${goalId}`);
    await say("on track");
    await say("nonsense");

    const after = await wb.admin.query(
      "select next_check_in_at from goals where id = $1",
      [goalId],
    );
    // §8.1's own acceptance line: the goal is still due and the next nudge
    // starts the conversation again from the beginning.
    expect(after.rows[0].next_check_in_at).toEqual(
      before.rows[0].next_check_in_at,
    );
  });

  it("treats an expired conversation as no conversation", async () => {
    await say(`checkin ${goalId}`);
    await say("on track");

    // Thirty-one minutes later, past the default window.
    const later = new Date("2026-08-27T09:31:00.000Z");
    const reply = await say("8", later);

    // Not read as an answer: it is parsed as a command, and there is no "8"
    // command, so the reply names what is available.
    expect(reply.text).toMatch(/do not have/);
    expect(
      (await checkInRows()).every((row) => row.published_at === null),
    ).toBe(true);
  });

  it("keeps the window open per answer, not per conversation", async () => {
    await say(`checkin ${goalId}`);
    // Twenty minutes for each answer: inside the window every time, so
    // somebody answering slowly is still answering.
    await say("on track", new Date("2026-08-27T09:20:00.000Z"));
    const reply = await say("8", new Date("2026-08-27T09:40:00.000Z"));
    expect(reply.text).toMatch(/One line on why/);
  });

  it("resumes from the row rather than from memory", async () => {
    await say(`checkin ${goalId}`);
    await say("on track");
    await say("8");

    // Nothing here holds state between messages: each `say` reads the row
    // back. The assertion is that the third answer landed on the right
    // question, which is only true if the row is what carried it.
    const rows = await conversationRows();
    expect(rows[0]?.awaiting).toBe("narrative");
    expect(rows[0]?.collected.status).toBe("on_track");
    expect(rows[0]?.collected.confidence).toBe(0.8);
  });
});

describe("the whole thing", () => {
  /**
   * The acceptance criterion, in the words the task states it.
   */
  it("publishes the record the browser produces, and moves the cadence (acceptance)", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query(
      "select next_check_in_at from goals where id = $1",
      [goalId],
    );

    await say(`checkin ${goalId}`);
    await say("on track");
    await say("8");
    await say("Two enterprise renewals landed early.");
    const done = await say("112");

    expect(done.text).toMatch(/Checked in/);

    // One published check-in, with the answers on it.
    const published = (await checkInRows()).filter(
      (row) => row.published_at !== null,
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.status).toBe("on_track");
    expect(Number(published[0]?.confidence)).toBeCloseTo(0.8, 5);
    // Rich text, through the shared module, not a bare string.
    expect(published[0]?.narrative).toMatchObject({ type: "doc" });

    // The key result's value was written, and the snapshot records it the way
    // the browser's composer does: one entry per key result, on the check-in.
    const kr = await wb.admin.query(
      "select current_value from key_results where id = $1",
      [keyResultIds[0]],
    );
    expect(Number(kr.rows[0].current_value)).toBe(112);

    const snapshot = await wb.admin.query(
      "select entries from check_in_snapshots where workspace_id = $1",
      [workspaceId],
    );
    expect(snapshot.rows).toHaveLength(1);
    const entries = snapshot.rows[0].entries as Array<{
      keyResultId: string;
      value: number;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.keyResultId).toBe(keyResultIds[0]);
    expect(Number(entries[0]?.value)).toBe(112);

    // The cadence moved.
    const after = await wb.admin.query(
      "select next_check_in_at from goals where id = $1",
      [goalId],
    );
    expect(after.rows[0].next_check_in_at).not.toEqual(
      before.rows[0].next_check_in_at,
    );

    // And the conversation is gone.
    expect(await conversationRows()).toEqual([]);
  });

  it("audits the publication with the channel on it", async () => {
    const wb = await workerDb();
    await say(`checkin ${goalId}`);
    await say("on track");
    await say("8");
    await say("Two enterprise renewals landed early.");
    await say("112");

    const audited = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'goals.publishCheckIn'",
      [workspaceId],
    );
    expect(audited.rows).toHaveLength(1);
    expect((audited.rows[0].payload as Record<string, unknown>).channel).toBe(
      "slack",
    );
  });
});

describe("the same check-in through a form", () => {
  const submit = async (
    fields: Record<string, string>,
    at = new Date("2026-08-27T09:00:00.000Z"),
  ) => {
    const wb = await workerDb();
    return submitCheckIn(
      {
        pool: wb.appPool,
        workspaceId,
        provider: "slack",
        memberId: championMemberId,
        userId: CHAMPION,
        now: at,
        minutes: 30,
      },
      { goalId, fields },
    );
  };

  /**
   * The acceptance criterion for P5-T02b, and it is deliberately a comparison
   * rather than a fresh set of assertions: a modal is a nicer way to ask the
   * same questions, not a second way to write a check-in. If the two paths ever
   * produce different records, this is what says so.
   */
  it("produces what the conversational path produces (acceptance)", async () => {
    const wb = await workerDb();

    // The conversational path first, on this goal.
    await say(`checkin ${goalId}`);
    await say("on track");
    await say("8");
    await say("Two enterprise renewals landed early.");
    await say("112");

    const throughChat = (await checkInRows()).filter(
      (row) => row.published_at !== null,
    );
    expect(throughChat).toHaveLength(1);

    // A second workspace would be cleaner but the comparison that matters is
    // the shape, so the same goal is checked in again through the form: the
    // draft reopens rather than duplicating, which P3-T08 already guarantees.
    const published = await submit({
      status: "on track",
      confidence: "8",
      narrative: "Two enterprise renewals landed early.",
    });
    expect(published.kind).toBe("done");

    const rows = (await checkInRows()).filter(
      (row) => row.published_at !== null,
    );
    // Same status and same confidence, whichever way it arrived.
    expect(rows.map((row) => row.status)).toEqual(rows.map(() => "on_track"));
    for (const row of rows) {
      expect(Number(row.confidence)).toBeCloseTo(0.8, 5);
      expect(row.narrative).toMatchObject({ type: "doc" });
    }

    const audited = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'goals.publishCheckIn'",
      [workspaceId],
    );
    // Every publication, from either path, names the channel.
    expect(audited.rows.length).toBeGreaterThan(0);
    for (const row of audited.rows) {
      expect((row.payload as Record<string, unknown>).channel).toBe("slack");
    }
  });

  it("refuses a form whose answers are not answers, and writes nothing", async () => {
    const outcome = await submit({
      status: "brilliant",
      confidence: "8",
      narrative: "All good.",
    });

    expect(outcome.kind).toBe("abandoned");
    if (outcome.kind === "abandoned") {
      expect(outcome.text).toMatch(/not an answer/);
    }
    expect(
      (await checkInRows()).every((row) => row.published_at === null),
    ).toBe(true);
  });

  it("leaves out a field the form did not carry rather than guessing at it", async () => {
    // The key result's value is not on the form yet. Absent, not zero: a form
    // that silently wrote a number nobody typed would be worse than one that
    // never asked.
    const outcome = await submit({
      status: "caution",
      confidence: "5",
      narrative: "Waiting on two renewals.",
    });
    expect(outcome.kind).toBe("done");

    const wb = await workerDb();
    const kr = await wb.admin.query(
      "select current_value from key_results where id = $1",
      [keyResultIds[0]],
    );
    expect(Number(kr.rows[0].current_value)).toBe(100);
  });

  it("starts no conversation, because a form holds its own state", async () => {
    await submit({
      status: "on track",
      confidence: "9",
      narrative: "Ahead of plan.",
    });
    expect(await conversationRows()).toEqual([]);
  });
});
