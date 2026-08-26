/**
 * The list filter assist (AI-NATIVE-PLAN.md §2.4, P4-T15d).
 *
 * The task's test plan:
 * - a sentence that cannot be expressed in the filter grammar is refused with
 *   the reason, not silently narrowed
 * - the manual filters are unchanged with the provider off
 *
 * The first line is the point of the whole row. An assist that narrowed "goals
 * blocked on legal" to "off-track goals" would hand somebody a list they believe
 * is one thing and is another, and they would act on it. So refusing is a
 * first-class answer here, and most of this file is about the ways a refusal has
 * to happen: the model saying it cannot, the model naming a level the product
 * does not have, the model pointing at a cycle past the end of the list, and the
 * model returning a filter that filters nothing.
 */
import type { AgentDrafter, ParsedFilter } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "filter-owner";
const OTHER = "filter-other";

let workspaceId: string;
let cycleId: string;
let cycleName: string;
let spaceId: string;
let ownerMemberId: string;
let otherMemberId: string;

const drafterWith = (answer: ParsedFilter | null): AgentDrafter => ({
  spentUsd: () => 0,
  async parseListFilter() {
    return answer;
  },
});

const contextFor = async (drafter?: AgentDrafter, userId = OWNER) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
    drafter,
  };
};

const call = async (
  name: string,
  input: unknown,
  drafter?: AgentDrafter,
  userId = OWNER,
) =>
  callAction(await contextFor(drafter, userId), name as never, input as never);

const parse = async (sentence: string, answer: ParsedFilter | null) =>
  call("goals.parseFilter", { sentence }, drafterWith(answer));

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Ben', $4)`,
    [OWNER, "filter-owner@example.com", OTHER, "filter-other@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
    name: string;
  };
  cycleId = cycle.id;
  cycleName = cycle.name;

  const other = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Ben', 'active') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = other.rows[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("with the provider off", () => {
  it("offers nothing, and the manual filters are untouched", async () => {
    expect(
      await call("goals.parseFilter", { sentence: "my off-track goals" }),
    ).toBeNull();
    // The manual path: the explorer's own filters are `goals.list` arguments,
    // and they answer exactly as they did.
    const listed = (await call("goals.list", {
      cycleId,
      includeClosed: false,
      health: "off_track",
    })) as { goals: unknown[] };
    expect(Array.isArray(listed.goals)).toBe(true);
  });
});

describe("a sentence the grammar can express", () => {
  it("becomes a filter, with the product's own words for it", async () => {
    const parsed = (await parse("my off-track goals this quarter", {
      kind: "filter",
      cycleNumber: 1,
      level: null,
      health: "off_track",
      mine: true,
      includeClosed: false,
    })) as {
      kind: string;
      filter: {
        cycleId: string | null;
        health: string | null;
        mine: boolean;
        summary: string;
      };
    };

    expect(parsed.kind).toBe("filter");
    // The identifier is the product's: the model answered with the number 1.
    expect(parsed.filter.cycleId).toBe(cycleId);
    expect(parsed.filter.health).toBe("off_track");
    expect(parsed.filter.mine).toBe(true);
    // In the product's words, so a reader can check what it understood at a
    // glance rather than trusting it.
    expect(parsed.filter.summary).toBe(`yours, off track, in ${cycleName}`);
  });

  it("is shown cycle names and never an identifier", async () => {
    let seen = "";
    await call(
      "goals.parseFilter",
      { sentence: "anything" },
      {
        spentUsd: () => 0,
        async parseListFilter(context) {
          seen = JSON.stringify(context);
          return null;
        },
      },
    );
    expect(seen).toContain(cycleName);
    expect(seen).not.toContain(cycleId);
    // The enums travel too, so the model is choosing from the grammar rather
    // than guessing at it.
    expect(seen).toContain("off_track");
    expect(seen).toContain("individual");
  });
});

describe("a sentence the grammar cannot express", () => {
  it("is refused with the model's own reason", async () => {
    const refused = (await parse("goals blocked on the legal team", {
      kind: "refused",
      reason: "This list cannot filter on what a goal is blocked by.",
    })) as { kind: string; reason: string };
    expect(refused.kind).toBe("refused");
    expect(refused.reason).toContain("blocked by");
  });

  it("is refused with the product's words when the model gives no reason", async () => {
    const refused = (await parse("goals blocked on legal", {
      kind: "refused",
      reason: "   ",
    })) as { kind: string; reason: string };
    expect(refused.reason).toBe(
      "That is not something this list can filter on.",
    );
  });

  it("is refused, not narrowed, when the model invents a level", async () => {
    // "squad" is not one of the four levels. Silently dropping it would return
    // every goal in the cycle as though the sentence had been understood.
    const refused = (await parse("squad goals", {
      kind: "filter",
      cycleNumber: null,
      level: "squad",
      health: null,
      mine: false,
      includeClosed: false,
    })) as { kind: string; reason: string };
    expect(refused.kind).toBe("refused");
    expect(refused.reason).toContain("squad");
  });

  it("is refused when the model invents a health band", async () => {
    const refused = (await parse("goals that are struggling", {
      kind: "filter",
      cycleNumber: null,
      level: null,
      health: "struggling",
      mine: false,
      includeClosed: false,
    })) as { kind: string; reason: string };
    expect(refused.kind).toBe("refused");
    expect(refused.reason).toContain("struggling");
  });

  it("is refused when the model points past the end of the cycle list", async () => {
    const refused = (await parse("goals from 2019", {
      kind: "filter",
      cycleNumber: 9,
      level: null,
      health: null,
      mine: false,
      includeClosed: false,
    })) as { kind: string; reason: string };
    expect(refused.kind).toBe("refused");
    expect(refused.reason).toBe("That is not a cycle you can see.");
  });

  it("is refused when the filter would filter nothing", async () => {
    // A model that understood nothing and answered with an empty filter would
    // otherwise hand back the unfiltered list as though it were an answer.
    const refused = (await parse("hello", {
      kind: "filter",
      cycleNumber: null,
      level: null,
      health: null,
      mine: false,
      includeClosed: false,
    })) as { kind: string; reason: string };
    expect(refused.kind).toBe("refused");
    expect(refused.reason).toContain("Nothing in that names");
  });
});

describe("the filter it produces is one the reader could have typed", () => {
  it("lists exactly what the manual filter lists", async () => {
    const mine = (await call("goals.create", {
      title: "Raise mid-market activation",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    const theirs = (await call("goals.create", {
      title: "Cut onboarding time",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: otherMemberId,
      reviewerId: otherMemberId,
      weight: 1,
    })) as { id: string };

    const wb = await workerDb();
    await wb.admin.query(
      "update goals set health = 'off_track' where id in ($1, $2)",
      [mine.id, theirs.id],
    );

    const parsed = (await parse("my off-track goals this quarter", {
      kind: "filter",
      cycleNumber: 1,
      level: null,
      health: "off_track",
      mine: true,
      includeClosed: false,
    })) as {
      filter: {
        cycleId: string;
        health: string;
        mine: boolean;
        includeClosed: boolean;
      };
    };

    // The point of the acceptance criterion: what comes back is the explorer's
    // own filter state, so running it gives the same list as setting those
    // filters by hand.
    const listed = (await call("goals.list", {
      cycleId: parsed.filter.cycleId,
      health: parsed.filter.health,
      mine: parsed.filter.mine,
      includeClosed: parsed.filter.includeClosed,
    })) as { goals: { id: string }[] };

    expect(listed.goals.map((goal) => goal.id)).toEqual([mine.id]);
  });
});
