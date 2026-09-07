import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { buildMessage, withLinkedButtons } from "../src/channels/builder.ts";
import { routeCommand } from "../src/channels/router.ts";
import {
  ageInWords,
  blockerDraft,
  isBlockerRule,
} from "../src/nudges/blocker-card.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The blocker escalation card (P5-T03b).
 *
 * The acceptance criterion is that a coordinator receives a card carrying the
 * blocker, its age and an action to reassign or resolve. Everything below is
 * that sentence taken apart: what the draft holds, what each provider makes of
 * it, and that both actions reach the registry.
 */

const OWNER = "card-owner";
const COORDINATOR = "card-coordinator";

let workspaceId: string;
let ownerMemberId: string;
let coordinatorMemberId: string;
let spaceId: string;
let keyResultId: string;
let blockerId: string;
let sessionId: string;
/**
 * When the row says it was opened.
 *
 * Read back rather than assumed. `createBlocker` stamps the real clock, which
 * is milliseconds after this file captured `NOW`, so an age computed from
 * `NOW` floors to an hour less than the test meant. The row's own moment is
 * the only one the product will ever compare against.
 */
let openedAt: Date;

const NOW = new Date();

const asOwner = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Owner",
      "card-owner@example.com",
      COORDINATOR,
      "Coordinator",
      "card-coordinator@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  const member = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  ownerMemberId = member.rows[0].id as string;

  const space = await callAction(
    { pool: wb.appPool, ...asOwner() },
    "spaces.create",
    { name: "Platform" },
  );
  spaceId = space.id;

  const coordinator = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Coordinator', 'active') returning id`,
    [workspaceId, COORDINATOR],
  );
  coordinatorMemberId = coordinator.rows[0]?.id as string;
  await callAction({ pool: wb.appPool, ...asOwner() }, "spaces.addMember", {
    spaceId,
    memberId: coordinatorMemberId,
    role: "member",
  });

  const cycle = await callAction(
    { pool: wb.appPool, ...asOwner() },
    "cycles.current",
    { mode: "quarterly" },
  );
  const goal = (await callAction(
    { pool: wb.appPool, ...asOwner() },
    "goals.create",
    {
      cycleId: cycle?.id as string,
      level: "team",
      spaceId,
      ownerKind: "space",
      title: "Ship the platform migration",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    },
  )) as { id: string };

  const kr = (await callAction(
    { pool: wb.appPool, ...asOwner() },
    "goals.addKeyResult",
    {
      goalId: goal.id,
      title: "Move 40 services onto the new runtime",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 0,
      targetValue: 40,
      weight: 1,
    },
  )) as { id: string };
  keyResultId = kr.id;

  const session = await callAction(
    { pool: wb.appPool, ...asOwner() },
    "sessions.create",
    {
      spaceId,
      kind: "weekly",
      title: "Weekly",
      scheduledFor: NOW.toISOString(),
      facilitatorId: ownerMemberId,
    },
  );
  sessionId = session.id;
  await callAction({ pool: wb.appPool, ...asOwner() }, "sessions.open", {
    id: sessionId,
  });

  const blocker = await callAction(
    { pool: wb.appPool, ...asOwner() },
    "sessions.createBlocker",
    {
      sessionId,
      keyResultId,
      type: "dependency",
      ownerId: ownerMemberId,
      nextAction: "Chase the vendor for a date",
    },
  );
  blockerId = (blocker as { id: string }).id;
  const opened = await wb.admin.query<{ opened_at: Date }>(
    "select opened_at from blockers where id = $1",
    [blockerId],
  );
  openedAt = opened.rows[0]?.opened_at as Date;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("how old, in words", () => {
  it("says hours up to two days and days after that", () => {
    const at = (hours: number) =>
      ageInWords(new Date(NOW.getTime() - hours * 3_600_000), NOW);
    expect(at(0)).toBe("less than an hour");
    expect(at(1)).toBe("1 hour");
    expect(at(26)).toBe("26 hours");
    // Past two days, "seventy-three hours" is a number nobody converts.
    expect(at(73)).toBe("3 days");
  });

  it("never reads as negative for a clock that has drifted", () => {
    expect(ageInWords(new Date(NOW.getTime() + 3_600_000), NOW)).toBe(
      "less than an hour",
    );
  });
});

describe("which rules carry a card", () => {
  it("is the three blocker rules and nothing else", () => {
    expect(isBlockerRule("blocker.warning")).toBe(true);
    expect(isBlockerRule("blocker.overdue")).toBe(true);
    expect(isBlockerRule("blocker.escalated")).toBe(true);
    expect(isBlockerRule("checkin.due_soon")).toBe(false);
  });
});

describe("the draft", () => {
  const draft = async (over: Record<string, unknown> = {}) => {
    const wb = await workerDb();
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { withWorkspace } = await import("@openokr/db");
    return withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      blockerDraft(tx, {
        workspaceId,
        blockerId,
        ruleKey: "blocker.overdue",
        now: new Date(openedAt.getTime() + 26 * 3_600_000),
        baseUrl: "https://okr.example/",
        ...over,
      }),
    );
  };

  it("carries the blocker, its age and what it blocks", async () => {
    const built = await draft();
    expect(built?.text).toContain("26 hours");
    expect(built?.text).toContain("Chase the vendor for a date");
    expect(built?.text).toContain("Move 40 services onto the new runtime");
    // The rule key, which every proactive message is required to carry.
    expect(built?.text).toContain("blocker.overdue");
  });

  it("offers exactly two actions, and a link to the board", async () => {
    const built = await draft();
    const labels = (built?.buttons ?? []).map((button) => button.label);
    expect(labels).toEqual(["Resolve", "Take it on", "Open the board"]);

    const commands = (built?.buttons ?? [])
      .map((button) => button.url)
      .filter((url) => url.startsWith("okr:"));
    expect(commands).toEqual([
      `okr:resolve ${blockerId}`,
      `okr:take ${blockerId}`,
    ]);
  });

  it("leaves the board link out when there is no address to build one from", async () => {
    const built = await draft({ baseUrl: undefined });
    expect((built?.buttons ?? []).map((b) => b.label)).toEqual([
      "Resolve",
      "Take it on",
    ]);
  });

  it("says nothing at all once the blocker is resolved", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "sessions.resolveBlocker",
      { id: blockerId },
    );
    // The ordinary race: scheduled at eight, delivered at nine, closed at half
    // past. A card about something no longer true is worse than the generic
    // line the caller falls back to.
    expect(await draft()).toBeNull();
  });
});

describe("what each provider makes of it", () => {
  const draftFor = async () => {
    const wb = await workerDb();
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { withWorkspace } = await import("@openokr/db");
    const built = await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      blockerDraft(tx, {
        workspaceId,
        blockerId,
        ruleKey: "blocker.overdue",
        now: new Date(openedAt.getTime() + 26 * 3_600_000),
      }),
    );
    if (!built) {
      throw new Error("expected a draft");
    }
    return built;
  };

  it("keeps the card and the actions for Teams", async () => {
    const message = buildMessage(await draftFor(), "teams");
    expect(message.blocks).toHaveLength(1);
    expect(message.buttons).toHaveLength(2);
    expect(message.degraded).toEqual([]);
  });

  it("keeps the actions and drops the card for Telegram", async () => {
    const message = buildMessage(await draftFor(), "telegram");
    expect(message.blocks).toBeUndefined();
    expect(message.buttons).toHaveLength(2);
    expect(message.degraded).toEqual([
      "telegram has no rich cards, so the blocks were dropped",
    ]);
  });

  /**
   * The defect this test exists for: a command button is not a link.
   */
  it("turns a command into the words to type where there are no buttons", async () => {
    const built = await draftFor();
    const text = withLinkedButtons({
      ...built,
      buttons: [
        { label: "Resolve", url: `okr:resolve ${blockerId}` },
        { label: "Open the board", url: "https://okr.example/spaces/1" },
      ],
    });

    // Not "Resolve: okr:resolve abc", which is a line somebody clicks and
    // nothing happens.
    expect(text).toContain(`Resolve: reply "resolve ${blockerId}"`);
    expect(text).toContain("Open the board: https://okr.example/spaces/1");
    expect(text).not.toContain("Resolve: okr:");
  });
});

describe("the two actions the card offers", () => {
  const say = async (text: string, userId = COORDINATOR) => {
    const wb = await workerDb();
    return routeCommand({
      pool: wb.appPool,
      workspaceId,
      provider: "teams",
      memberId: userId === COORDINATOR ? coordinatorMemberId : ownerMemberId,
      userId,
      text,
      now: NOW,
    });
  };

  it("resolves one, from the card's own command", async () => {
    const wb = await workerDb();
    const reply = await say(`resolve ${blockerId}`);
    expect(reply.kind).toBe("done");

    const row = await wb.admin.query(
      "select resolved_at from blockers where id = $1",
      [blockerId],
    );
    expect(row.rows[0].resolved_at).not.toBeNull();
  });

  /**
   * The acceptance criterion's other half: reassign.
   */
  it("hands one to whoever pressed the button, and to nobody else", async () => {
    const wb = await workerDb();
    const reply = await say(`take ${blockerId}`);
    expect(reply.kind).toBe("done");

    const row = await wb.admin.query(
      "select owner_id from blockers where id = $1",
      [blockerId],
    );
    // The sender, filled in by the router. There is no way to name somebody
    // else from a chat line, which is deliberate.
    expect(row.rows[0].owner_id).toBe(coordinatorMemberId);

    const audited = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'sessions.reassignBlocker'",
      [workspaceId],
    );
    expect(audited.rows).toHaveLength(1);
    expect((audited.rows[0].payload as Record<string, unknown>).channel).toBe(
      "teams",
    );
  });

  it("refuses to hand over one that is already closed", async () => {
    await say(`resolve ${blockerId}`);
    const reply = await say(`take ${blockerId}`);
    expect(reply.kind).toBe("reply");
    expect(reply.text).toContain("No such open blocker");
  });

  it("says which argument is missing rather than failing silently", async () => {
    const reply = await say("take");
    expect(reply.text).toContain("take needs");
    expect(reply.text).toContain("identifier");
  });

  it("lists both in the help, from the catalogue", async () => {
    const reply = await say("help");
    expect(reply.text).toContain("resolve");
    expect(reply.text).toContain("take");
  });
});
