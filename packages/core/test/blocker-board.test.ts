/**
 * The blocker board and the two P4-T15b-b assists (METHOD.md §7.3 and §11,
 * AI-NATIVE-PLAN.md §2.2).
 *
 * The task's test plan:
 * - the ranking is the product's and not the model's, so the summary cannot
 *   reorder it
 * - a suggested formula that does not parse is refused rather than offered
 *
 * **§7.3 states no ranking, so the order below is derived and the derivation is
 * what these tests pin down.** §11's ladder is the product's own statement of
 * urgency, so the rungs come first; then §3.2's band for what the blocker holds
 * up, which is "impact" in the only terms this product measures; then age, which
 * is the thing §7.3 does name. If that reading is wrong, these tests are where it
 * is written down and where changing it will be noticed.
 */
import type { AgentDrafter } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mentionedButUnknown } from "../src/actions/blocker-board.ts";
import { buildFormula } from "../src/actions/kpi-assist.ts";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "board-owner";

let workspaceId: string;
let spaceId: string;
let cycleId: string;
let ownerMemberId: string;
let sessionId: string;

const drafterWith = (parts: Partial<AgentDrafter>): AgentDrafter => ({
  spentUsd: () => 0,
  ...parts,
});

const contextFor = async (drafter?: AgentDrafter) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
    drafter,
  };
};

const call = async (name: string, input: unknown, drafter?: AgentDrafter) =>
  callAction(await contextFor(drafter), name as never, input as never);

/** Opens a blocker on the session, aged by hours. */
const openBlocker = async (
  nextAction: string,
  ageHours: number,
  options: { readonly goalId?: string; readonly type?: string } = {},
) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into blockers
       (id, workspace_id, type, owner_id, next_action, opened_at, due_at, session_id, goal_id)
     values (gen_random_uuid(), $1, $2, $3, $4,
             now() - ($5 || ' hours')::interval,
             now() - ($5 || ' hours')::interval + interval '24 hours',
             $6, $7)
     returning id`,
    [
      workspaceId,
      options.type ?? "dependency",
      ownerMemberId,
      nextAction,
      String(ageHours),
      sessionId,
      options.goalId ?? null,
    ],
  );
  return rows[0]?.id as string;
};

const board = async () =>
  (
    (await call("blockers.board", { spaceId })) as {
      blockers: {
        nextAction: string;
        escalation: string;
        pastTheClock: boolean;
        ageHours: number;
      }[];
    }
  ).blockers;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "board-owner@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as { id: string }
  ).id;

  const session = (await call("sessions.create", {
    spaceId,
    cycleId,
    kind: "weekly",
    title: "Week of 24 August",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: ownerMemberId,
  })) as { id: string };
  sessionId = session.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the board, with no provider anywhere near it", () => {
  it("is empty for a space with nothing stuck", async () => {
    expect(await board()).toEqual([]);
  });

  it("puts §11's ladder first, whatever the ages say", async () => {
    await openBlocker("Waiting on billing", 50);
    await openBlocker("Waiting on legal", 25);
    await openBlocker("Waiting on design", 21);
    await openBlocker("Waiting on nobody", 2);

    const ranked = await board();
    expect(ranked.map((entry) => entry.escalation)).toEqual([
      "sponsor",
      "coordinator",
      "owner",
      "none",
    ]);
    expect(ranked.map((entry) => entry.nextAction)).toEqual([
      "Waiting on billing",
      "Waiting on legal",
      "Waiting on design",
      "Waiting on nobody",
    ]);
  });

  it("breaks a tie on the ladder with what the blocker holds up", async () => {
    const offTrack = (await call("goals.create", {
      title: "Raise mid-market activation",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    const healthy = (await call("goals.create", {
      title: "Cut onboarding time",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    const wb = await workerDb();
    await wb.admin.query(
      "update goals set health = 'off_track' where id = $1",
      [offTrack.id],
    );

    // Same rung, same age. What they block is the only difference.
    await openBlocker("Blocks the healthy one", 30, { goalId: healthy.id });
    await openBlocker("Blocks the off-track one", 30, { goalId: offTrack.id });

    expect((await board()).map((entry) => entry.nextAction)).toEqual([
      "Blocks the off-track one",
      "Blocks the healthy one",
    ]);
  });

  it("marks what is past §7.3's clock", async () => {
    await openBlocker("Past it", 25);
    await openBlocker("Inside it", 5);
    const ranked = await board();
    expect(ranked[0]?.pastTheClock).toBe(true);
    expect(ranked[1]?.pastTheClock).toBe(false);
  });

  it("leaves out a resolved blocker", async () => {
    const id = await openBlocker("Already done", 40);
    const wb = await workerDb();
    await wb.admin.query(
      "update blockers set resolved_at = now() where id = $1",
      [id],
    );
    expect(await board()).toEqual([]);
  });
});

describe("the summary the assist writes", () => {
  it("is absent with the provider off", async () => {
    await openBlocker("Waiting on billing", 30);
    expect(await call("blockers.summarise", { spaceId })).toBeNull();
  });

  it("is absent when there is nothing stuck, because the board says it better", async () => {
    expect(
      await call(
        "blockers.summarise",
        { spaceId },
        drafterWith({
          async summariseBlockers() {
            return "Should never be reached.";
          },
        }),
      ),
    ).toBeNull();
  });

  it("carries the board back in the product's order, not the model's", async () => {
    await openBlocker("Waiting on billing", 50);
    await openBlocker("Waiting on nobody", 2);

    const summarised = (await call(
      "blockers.summarise",
      { spaceId },
      drafterWith({
        async summariseBlockers() {
          // The model writes about them in the other order. It does not matter:
          // the order is the board's, and the board comes back unchanged.
          return "Design is nearly free; billing is the real one.";
        },
      }),
    )) as { summary: string; blockers: { nextAction: string }[] };

    expect(summarised.blockers.map((entry) => entry.nextAction)).toEqual([
      "Waiting on billing",
      "Waiting on nobody",
    ]);
  });

  it("is shown the board in order, with the rungs", async () => {
    await openBlocker("Waiting on billing", 50);
    await openBlocker("Waiting on nobody", 2);
    let seen: readonly { nextAction: string; escalation: string }[] = [];
    await call(
      "blockers.summarise",
      { spaceId },
      drafterWith({
        async summariseBlockers(context) {
          seen = context.blockers;
          return null;
        },
      }),
    );
    expect(seen.map((entry) => entry.nextAction)).toEqual([
      "Waiting on billing",
      "Waiting on nobody",
    ]);
    expect(seen[0]?.escalation).toBe("sponsor");
  });

  it("is dropped when it quotes a blocker that is not on the board", async () => {
    await openBlocker("Waiting on billing", 30);
    expect(
      await call(
        "blockers.summarise",
        { spaceId },
        drafterWith({
          async summariseBlockers() {
            // Quoted, so it is a specific claim about the board, and it is false.
            return 'The oldest one is "Waiting on the security review".';
          },
        }),
      ),
    ).toBeNull();
  });

  it("is kept when it quotes one that is on the board", async () => {
    await openBlocker("Waiting on billing", 30);
    const summarised = (await call(
      "blockers.summarise",
      { spaceId },
      drafterWith({
        async summariseBlockers() {
          return 'One thing is stuck: "Waiting on billing", past its clock.';
        },
      }),
    )) as { summary: string };
    expect(summarised.summary).toContain("Waiting on billing");
  });
});

describe("the quoted-claim check on its own", () => {
  it("passes prose with no quotations in it", () => {
    expect(mentionedButUnknown("Two things are stuck.", ["a"])).toBe(false);
  });

  it("passes a quotation that is on the list", () => {
    expect(
      mentionedButUnknown('Stuck on "waiting on billing".', [
        "waiting on billing",
      ]),
    ).toBe(false);
  });

  it("catches a quotation that is not", () => {
    expect(
      mentionedButUnknown('Stuck on "the security review".', [
        "waiting on billing",
      ]),
    ).toBe(true);
  });
});

describe("a suggested formula", () => {
  it("is refused when it refers to a metric that is not there", () => {
    const built = buildFormula({ operation: "div", references: [1, 9] }, [
      "one",
      "two",
    ]);
    expect(built.formula).toBeNull();
    expect(built.formulaRefused).toBe(
      "It referred to a metric that is not there.",
    );
  });

  it("is refused for arithmetic §6 does not do", () => {
    const built = buildFormula(
      { operation: "exponentiate", references: [1, 2] },
      ["one", "two"],
    );
    expect(built.formula).toBeNull();
    expect(built.formulaRefused).toContain("exponentiate");
  });

  it("is refused when it names only one metric, which is not a formula", () => {
    const built = buildFormula({ operation: "div", references: [1] }, [
      "one",
      "two",
    ]);
    expect(built.formula).toBeNull();
    expect(built.formulaRefused).toContain("at least two metrics");
  });

  it("is built in §6's own shape, and passes §6's own parser", () => {
    const built = buildFormula({ operation: "div", references: [1, 2] }, [
      "one",
      "two",
    ]);
    expect(built.formulaRefused).toBeNull();
    // The parser's own shape: one operator, a left and a right.
    expect(built.formula).toEqual({
      op: "div",
      l: { k: "one" },
      r: { k: "two" },
    });
  });

  it("folds three references left, because §6's operators are binary", () => {
    const built = buildFormula({ operation: "add", references: [1, 2, 3] }, [
      "one",
      "two",
      "three",
    ]);
    expect(built.formula).toEqual({
      op: "add",
      l: { op: "add", l: { k: "one" }, r: { k: "two" } },
      r: { k: "three" },
    });
  });

  it("is nothing at all when the model suggested none", () => {
    expect(buildFormula(null, ["one"])).toEqual({
      formula: null,
      formulaRefused: null,
    });
  });
});

describe("the KPI suggestion", () => {
  it("is absent with the provider off", async () => {
    expect(
      await call("kpis.suggest", { description: "trial to paid conversion" }),
    ).toBeNull();
  });

  it("keeps the metric when the formula is refused", async () => {
    const suggested = (await call(
      "kpis.suggest",
      { description: "trial to paid conversion rate" },
      drafterWith({
        async suggestKpi() {
          return {
            title: "Trial to paid conversion",
            unit: "%",
            frequency: "monthly",
            direction: "higher_better",
            indicatorType: "outcome",
            targetDefault: 60,
            healthyPct: 95,
            watchPct: 85,
            // Nothing to reference: this workspace has no metrics yet.
            formula: { operation: "div", references: [1, 2] },
            why: "You asked for a conversion rate.",
          };
        },
      }),
    )) as {
      title: string;
      formula: unknown;
      formulaRefused: string | null;
      healthyPct: number | null;
    };

    // A metric with a bad formula is still a metric somebody wanted.
    expect(suggested.title).toBe("Trial to paid conversion");
    expect(suggested.formula).toBeNull();
    expect(suggested.formulaRefused).toContain("not there");
    expect(suggested.healthyPct).toBe(95);
  });

  it("drops a corridor outside §6's bounds and keeps the rest", async () => {
    const suggested = (await call(
      "kpis.suggest",
      { description: "anything" },
      drafterWith({
        async suggestKpi() {
          return {
            title: "Something",
            unit: null,
            frequency: "fortnightly",
            direction: "sideways",
            indicatorType: "vibes",
            targetDefault: null,
            healthyPct: 900,
            watchPct: -4,
            formula: null,
            why: "Because.",
          };
        },
      }),
    )) as {
      frequency: string;
      direction: string;
      tier: string;
      healthyPct: number | null;
      watchPct: number | null;
    };

    // Each field falls back on its own rather than losing the suggestion.
    expect(suggested.frequency).toBe("monthly");
    expect(suggested.direction).toBe("higher_better");
    expect(suggested.tier).toBe("output");
    expect(suggested.healthyPct).toBeNull();
    expect(suggested.watchPct).toBeNull();
  });

  it("is nothing when the model returns an empty title", async () => {
    expect(
      await call(
        "kpis.suggest",
        { description: "anything" },
        drafterWith({
          async suggestKpi() {
            return {
              title: "   ",
              unit: null,
              frequency: "monthly",
              direction: "higher_better",
              indicatorType: "output",
              targetDefault: null,
              healthyPct: null,
              watchPct: null,
              formula: null,
              why: "",
            };
          },
        }),
      ),
    ).toBeNull();
  });
});
