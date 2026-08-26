/**
 * The planning and drafting assists (AI-NATIVE-PLAN.md §2.1, P4-T15a).
 *
 * The task's test plan, line by line:
 * - every assist is absent with the provider off and the deterministic path is
 *   unchanged
 * - a suggestion is a proposal and never a write
 * - the suggested alignment parent is one the member may read
 *
 * The third line is the one worth reading the code for. It is not enforced by a
 * filter after the fact: the candidates handed to the model come from
 * `goals.list`, which is access-scoped, and the model answers with an index into
 * that list. There is no index it could return that resolves to a goal this
 * member cannot see, so the test that matters is the one where it returns an
 * index past the end and gets nothing.
 *
 * **"Never a write" is asserted by counting rows, not by reading the code.**
 * Every assist here is a read action, which the registry's own invariant test
 * already checks; these count goals and key results before and after so a future
 * change that starts writing is caught by behaviour rather than by shape.
 */
import { type AgentDrafter, ASSIST_FEATURE_KEYS } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "assist-owner";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let companyGoalId: string;
let teamGoalId: string;

/** A drafter with only the capabilities a test hands it. */
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

const counts = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ goals: string; measures: string }>(
    `select (select count(*) from goals) as goals,
            (select count(*) from key_results) as measures`,
  );
  return rows[0];
};

const goal = async (title: string, level: string) =>
  (
    (await call("goals.create", {
      title,
      cycleId,
      spaceId,
      level,
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, "assist-owner@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as { id: string }
  ).id;

  companyGoalId = await goal(
    "Become the platform mid-market teams reach for first",
    "company",
  );
  teamGoalId = await goal("Raise mid-market activation", "team");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("with the provider off", () => {
  it("offers nothing at all, and says so with null rather than an error", async () => {
    expect(
      await call("goals.draftObjective", {
        ambition: "We should win more mid-market deals",
        cycleId,
        level: "team",
      }),
    ).toBeNull();
    expect(
      await call("goals.suggestMeasure", {
        goalId: teamGoalId,
        title: "Trial to paid conversion",
      }),
    ).toBeNull();
    expect(
      await call("goals.suggestParent", { goalId: teamGoalId }),
    ).toBeNull();
  });

  it("leaves the deterministic path exactly as it was", async () => {
    // The acceptance criterion is about the Draft Coach behaving as it does
    // today, and the coach evaluates in the browser from `packages/method`
    // against what `goals.read` returns. So the thing to hold still is that
    // read: the quality fields, the verdict inputs, all of it, identical before
    // and after an assist was asked for and declined.
    const before = await call("goals.read", { id: teamGoalId });
    await call("goals.draftObjective", {
      ambition: "We should win more mid-market deals",
      cycleId,
      level: "team",
    });
    await call("goals.suggestParent", { goalId: teamGoalId });
    expect(await call("goals.read", { id: teamGoalId })).toEqual(before);
  });
});

describe("drafting an objective from an ambition", () => {
  const drafter = () =>
    drafterWith({
      async draftObjective() {
        return {
          title: "Raise mid-market activation to sixty per cent by Q4",
          description: "The trial-to-paid path is where the quarter is won.",
          keyResults: [
            {
              title: "Trial to paid conversion from 41% to 60%",
              unit: "%",
              direction: "increase" as const,
              indicatorType: "lagging" as const,
              baseline: 41,
              target: 60,
            },
            {
              // Deliberately missing its numbers in the sentence, so the
              // verdicts have something real to report.
              title: "Onboarding is faster",
              unit: "days",
              direction: "reduce" as const,
              indicatorType: "leading" as const,
              baseline: 4,
              target: 2,
            },
          ],
        };
      },
    });

  it("returns the draft with the checks it actually passes", async () => {
    const drafted = (await call(
      "goals.draftObjective",
      { ambition: "Win more mid-market deals", cycleId, level: "team" },
      drafter(),
    )) as {
      title: string;
      keyResults: { title: string; passing: string[]; failing: string[] }[];
      passing: string[];
      failing: string[];
    };

    expect(drafted.title).toContain("sixty per cent");
    expect(drafted.keyResults).toHaveLength(2);
    // From METHOD.md's own catalogue, not from the model: every id here is a §4
    // check, and a draft is described by what the rules say about it.
    expect([...drafted.passing, ...drafted.failing].length).toBeGreaterThan(0);
    for (const id of [...drafted.passing, ...drafted.failing]) {
      expect(id).toMatch(/^OBJ-/);
    }
    const second = drafted.keyResults[1];
    // The measure with no numbers in its sentence fails something, and the
    // response says which rather than presenting the draft as fine.
    expect(second?.failing.length).toBeGreaterThan(0);
  });

  it("writes nothing", async () => {
    const before = await counts();
    await call(
      "goals.draftObjective",
      { ambition: "Win more mid-market deals", cycleId, level: "team" },
      drafter(),
    );
    expect(await counts()).toEqual(before);
  });

  it("is shown what is already in the cycle, so it does not restate one", async () => {
    let seen: readonly string[] = [];
    await call(
      "goals.draftObjective",
      { ambition: "Win more mid-market deals", cycleId, level: "team" },
      drafterWith({
        async draftObjective(context) {
          seen = context.existingTitles;
          return null;
        },
      }),
    );
    expect(seen).toContain("Raise mid-market activation");
  });

  it("is nothing when the model returns an empty title", async () => {
    expect(
      await call(
        "goals.draftObjective",
        { ambition: "Something", cycleId, level: "team" },
        drafterWith({
          async draftObjective() {
            return { title: "   ", description: "", keyResults: [] };
          },
        }),
      ),
    ).toBeNull();
  });

  it("is nothing when the model throws", async () => {
    expect(
      await call(
        "goals.draftObjective",
        { ambition: "Something", cycleId, level: "team" },
        drafterWith({
          async draftObjective() {
            throw new Error("the provider fell over");
          },
        }),
      ),
    ).toBeNull();
  });

  it("is nothing when an administrator switched this assist off", async () => {
    const wb = await workerDb();
    // The key comes from the code rather than being retyped here, so a rename
    // breaks the test instead of quietly making it assert nothing.
    await wb.admin.query(
      `insert into ai_feature_settings (id, workspace_id, feature_key, enabled)
       values (gen_random_uuid(), $1, $2, false)`,
      [workspaceId, ASSIST_FEATURE_KEYS.draftObjective],
    );
    expect(
      await call(
        "goals.draftObjective",
        { ambition: "Something", cycleId, level: "team" },
        drafter(),
      ),
    ).toBeNull();
    // And only that one: the switches are per assist, so turning off the one
    // that is not helping keeps the other two.
    expect(
      await call(
        "goals.suggestMeasure",
        { goalId: teamGoalId, title: "Trial to paid conversion" },
        drafterWith({
          async suggestMeasure() {
            return {
              unit: "%",
              direction: "increase" as const,
              indicatorType: "lagging" as const,
              baseline: 41,
              target: 60,
            };
          },
        }),
      ),
    ).not.toBeNull();
  });
});

describe("suggesting the measures for a key result", () => {
  const drafter = () =>
    drafterWith({
      async suggestMeasure() {
        return {
          unit: "%",
          direction: "increase" as const,
          indicatorType: "lagging" as const,
          baseline: 41,
          target: 60,
        };
      },
    });

  it("returns the numbers and what they pass", async () => {
    const suggested = (await call(
      "goals.suggestMeasure",
      {
        goalId: teamGoalId,
        title: "Trial to paid conversion from 41% to 60%",
      },
      drafter(),
    )) as {
      baseline: number;
      target: number;
      passing: string[];
      failing: string[];
    };
    expect(suggested.baseline).toBe(41);
    expect(suggested.target).toBe(60);
    for (const id of [...suggested.passing, ...suggested.failing]) {
      expect(id).toMatch(/^KR-/);
    }
  });

  it("writes nothing", async () => {
    const before = await counts();
    await call(
      "goals.suggestMeasure",
      { goalId: teamGoalId, title: "Trial to paid conversion" },
      drafter(),
    );
    expect(await counts()).toEqual(before);
  });

  it("refuses before asking a model about a goal the reader cannot read", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [ownerMemberId],
    );
    let asked = false;
    await expect(
      call(
        "goals.suggestMeasure",
        { goalId: teamGoalId, title: "Anything" },
        drafterWith({
          async suggestMeasure() {
            asked = true;
            return null;
          },
        }),
      ),
    ).rejects.toThrow();
    // The order matters: the access check runs first, so nothing about a goal
    // they may not see is ever sent to a provider.
    expect(asked).toBe(false);
  });
});

describe("suggesting the alignment parent", () => {
  it("resolves the index to a goal the reader may read", async () => {
    const suggested = (await call(
      "goals.suggestParent",
      { goalId: teamGoalId },
      drafterWith({
        async suggestParent() {
          return {
            candidateIndex: 0,
            reason: "The team target rolls into it.",
          };
        },
      }),
    )) as { parentGoalId: string; parentTitle: string; reason: string };

    expect(suggested.parentGoalId).toBe(companyGoalId);
    expect(suggested.parentTitle).toContain("mid-market teams");
    expect(suggested.reason).toContain("rolls into it");
  });

  it("shows the model titles and levels, and never an identifier", async () => {
    let seen = "";
    await call(
      "goals.suggestParent",
      { goalId: teamGoalId },
      drafterWith({
        async suggestParent(context) {
          seen = JSON.stringify(context);
          return null;
        },
      }),
    );
    expect(seen).toContain(
      "Become the platform mid-market teams reach for first",
    );
    // The whole reason the answer is an index: there is no id in front of it.
    expect(seen).not.toContain(companyGoalId);
    expect(seen).not.toContain(teamGoalId);
  });

  it("offers only objectives above this one", async () => {
    const individual = await goal("Land three mid-market logos", "individual");
    let candidates: readonly { title: string }[] = [];
    await call(
      "goals.suggestParent",
      { goalId: individual },
      drafterWith({
        async suggestParent(context) {
          candidates = context.candidates;
          return null;
        },
      }),
    );
    // A parent is above the child. A sibling is a dependency, and §5 has its own
    // register for those.
    expect(candidates.map((candidate) => candidate.title).sort()).toEqual([
      "Become the platform mid-market teams reach for first",
      "Raise mid-market activation",
    ]);
  });

  it("suggests nothing for an index past the end of the list", async () => {
    expect(
      await call(
        "goals.suggestParent",
        { goalId: teamGoalId },
        drafterWith({
          async suggestParent() {
            return { candidateIndex: 9, reason: "Confidently wrong." };
          },
        }),
      ),
    ).toBeNull();
  });

  it("suggests nothing when there is nothing above this one", async () => {
    expect(
      await call(
        "goals.suggestParent",
        { goalId: companyGoalId },
        drafterWith({
          async suggestParent() {
            return { candidateIndex: 0, reason: "Should never be asked." };
          },
        }),
      ),
    ).toBeNull();
  });

  it("writes nothing", async () => {
    const before = await counts();
    await call(
      "goals.suggestParent",
      { goalId: teamGoalId },
      drafterWith({
        async suggestParent() {
          return {
            candidateIndex: 0,
            reason: "The team target rolls into it.",
          };
        },
      }),
    );
    expect(await counts()).toEqual(before);
  });
});

describe("provenance", () => {
  it("is recorded on an objective the reader kept from a draft", async () => {
    const created = (await call("goals.create", {
      title: "Raise mid-market activation to sixty per cent by Q4",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
      aiGenerated: true,
    })) as { id: string };

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ ai_generated: boolean }>(
      "select ai_generated from goals where id = $1",
      [created.id],
    );
    expect(rows[0]?.ai_generated).toBe(true);
  });

  it("is false for one somebody typed, which is the default", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ ai_generated: boolean }>(
      "select ai_generated from goals where id = $1",
      [teamGoalId],
    );
    expect(rows[0]?.ai_generated).toBe(false);
  });
});
