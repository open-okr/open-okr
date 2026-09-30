/**
 * The two §2.4 assists no task had built (AI-NATIVE-PLAN.md §2.4, completeness
 * review M-09): summarise a thread, and decompose a key result into
 * initiatives and tasks.
 *
 * Both are reads that write nothing, and both are only as good as the checks
 * between the model and the reader. So most of what is asserted here is what
 * the product refuses: a summary quoting words nobody wrote, a draft repeating
 * an initiative the key result already has, a list longer than §5.5's
 * capacity check would let a team finish, and any of it at all when the
 * provider is off, the assist is switched off, or the reader may not see the
 * thing it is about.
 *
 * What a real provider sends and what comes back is proved in
 * `packages/agents/test/work-assists-drafter.test.ts` against the mock driver,
 * including a reply the schema refuses. Here the drafter is a stand-in, because
 * the question is what core does with an answer, not how the answer is parsed.
 */
import { type AgentDrafter, ASSIST_FEATURE_KEYS } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { richTextFromPlainText } from "../src/rich-text/from-text.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "work-assist-owner";

let workspaceId: string;
let ownerMemberId: string;
let spaceId: string;
let cycleId: string;
let goalId: string;
let keyResultId: string;

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

const comment = async (text: string) =>
  call("comments.create", {
    subjectType: "goal",
    subjectId: goalId,
    body: richTextFromPlainText(text),
  });

const switchOff = async (featureKey: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into ai_feature_settings (id, workspace_id, feature_key, enabled)
     values (gen_random_uuid(), $1, $2, false)`,
    [workspaceId, featureKey],
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "work-assist-owner@example.com"],
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
  goalId = (
    (await call("goals.create", {
      title: "Raise mid-market activation",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
  keyResultId = (
    (await call("goals.addKeyResult", {
      goalId,
      title: "Raise trial to paid conversion from 18% to 30%",
      unit: "%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 18,
      targetValue: 30,
      weight: 1,
    })) as { id: string }
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("summarising a thread", () => {
  const thread = async () => {
    await comment("Billing keeps blocking the trial handover.");
    await comment("Agreed. Can finance own the handover by Friday?");
    await comment("We moved the pricing page last week and saw no change.");
  };

  const summariser = (summary: string, openQuestions: string[] = []) =>
    drafterWith({
      async summariseThread() {
        return { summary, openQuestions };
      },
    });

  const summarise = (drafter?: AgentDrafter) =>
    call(
      "comments.summarise",
      { subjectType: "goal", subjectId: goalId },
      drafter,
    );

  it("is absent with the provider off", async () => {
    await thread();
    expect(await summarise()).toBeNull();
  });

  it("is absent for a thread short enough to read at a glance", async () => {
    await comment("Only one thing to say.");
    await comment("And a reply.");
    expect(
      await summarise(summariser("Two people agreed on one thing.")),
    ).toBeNull();
  });

  it("is shown the words and the authors, and no identifier", async () => {
    await thread();
    let seen: {
      subject: string;
      comments: readonly { author: string; text: string }[];
    } | null = null;
    await summarise(
      drafterWith({
        async summariseThread(context) {
          seen = context;
          return null;
        },
      }),
    );
    expect(seen).toEqual({
      subject: "goal",
      comments: [
        { author: "Ada", text: "Billing keeps blocking the trial handover." },
        {
          author: "Ada",
          text: "Agreed. Can finance own the handover by Friday?",
        },
        {
          author: "Ada",
          text: "We moved the pricing page last week and saw no change.",
        },
      ],
    });
    expect(JSON.stringify(seen)).not.toContain(goalId);
    expect(JSON.stringify(seen)).not.toContain(ownerMemberId);
  });

  it("returns the summary and what the thread left open", async () => {
    await thread();
    const result = await summarise(
      summariser(
        "  Billing blocks the trial handover; pricing changed nothing.  ",
        ["  Can finance own the handover by Friday?  ", "   "],
      ),
    );
    expect(result).toEqual({
      summary: "Billing blocks the trial handover; pricing changed nothing.",
      // Blank entries dropped rather than shown as an empty bullet.
      openQuestions: ["Can finance own the handover by Friday?"],
      commentCount: 3,
    });
  });

  it("keeps a quotation somebody in the thread actually wrote", async () => {
    await thread();
    const result = (await summarise(
      summariser('The team says "billing keeps blocking the trial handover".'),
    )) as { summary: string } | null;
    expect(result?.summary).toContain("billing keeps blocking");
  });

  it("refuses a summary that quotes words nobody wrote", async () => {
    await thread();
    expect(
      await summarise(
        summariser('Finance said "we will never own the handover".'),
      ),
    ).toBeNull();
    expect(
      await summarise(
        summariser("Billing is the blocker.", [
          'Who agreed to "cancel the quarter"?',
        ]),
      ),
    ).toBeNull();
  });

  it("is nothing when the model declines or fails", async () => {
    await thread();
    expect(
      await summarise(
        drafterWith({
          async summariseThread() {
            throw new Error("the provider fell over");
          },
        }),
      ),
    ).toBeNull();
    expect(await summarise(summariser("   "))).toBeNull();
  });

  it("is nothing when an administrator switched it off", async () => {
    await thread();
    await switchOff(ASSIST_FEATURE_KEYS.summariseThread);
    expect(await summarise(summariser("Billing is the blocker."))).toBeNull();
  });

  it("tells a model nothing about a thread the reader cannot open", async () => {
    let asked = false;
    await expect(
      call(
        "comments.summarise",
        {
          subjectType: "goal",
          subjectId: "0193a4c2-0000-7000-8000-000000000000",
        },
        drafterWith({
          async summariseThread() {
            asked = true;
            return { summary: "Anything", openQuestions: [] };
          },
        }),
      ),
    ).rejects.toThrow();
    expect(asked).toBe(false);
  });

  it("writes nothing", async () => {
    await thread();
    const wb = await workerDb();
    const before = await wb.admin.query("select count(*) from audit_events");
    await summarise(summariser("Billing is the blocker."));
    const after = await wb.admin.query("select count(*) from audit_events");
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe("decomposing a key result", () => {
  const decompose = (drafter?: AgentDrafter, id = keyResultId) =>
    call("goals.decomposeKeyResult", { goalId, keyResultId: id }, drafter);

  const decomposer = (
    initiatives: { title: string; description: string; tasks: string[] }[],
  ) =>
    drafterWith({
      async decomposeKeyResult() {
        return initiatives;
      },
    });

  it("is absent with the provider off", async () => {
    expect(await decompose()).toBeNull();
  });

  it("is shown the key result's own numbers and what already moves it", async () => {
    await call("initiatives.create", {
      spaceId,
      title: "Rebuild the trial checklist",
      ownerId: ownerMemberId,
      keyResultIds: [keyResultId],
    });

    let seen: unknown = null;
    await decompose(
      drafterWith({
        async decomposeKeyResult(context) {
          seen = context;
          return null;
        },
      }),
    );
    expect(seen).toEqual({
      goalTitle: "Raise mid-market activation",
      keyResultTitle: "Raise trial to paid conversion from 18% to 30%",
      unit: "%",
      direction: "increase",
      baseline: 18,
      target: 30,
      current: 18,
      existingInitiatives: ["Rebuild the trial checklist"],
    });
    expect(JSON.stringify(seen)).not.toContain(keyResultId);
  });

  it("returns the drafts, tidied", async () => {
    const result = await decompose(
      decomposer([
        {
          title: "  Hand trials to finance  ",
          description: " A named owner for every trial past day ten. ",
          tasks: [" Draft the handover note ", "Draft the handover note", " "],
        },
      ]),
    );
    expect(result).toEqual({
      initiatives: [
        {
          title: "Hand trials to finance",
          description: "A named owner for every trial past day ten.",
          tasks: ["Draft the handover note"],
        },
      ],
    });
  });

  it("drops what the key result already has, what is blank, and what repeats", async () => {
    await call("initiatives.create", {
      spaceId,
      title: "Rebuild the trial checklist",
      ownerId: ownerMemberId,
      keyResultIds: [keyResultId],
    });
    const result = (await decompose(
      decomposer([
        { title: "rebuild the trial checklist", description: "", tasks: [] },
        { title: "   ", description: "Nothing", tasks: ["One"] },
        { title: "Price the annual plan", description: "", tasks: [] },
        { title: "PRICE THE ANNUAL PLAN", description: "", tasks: [] },
      ]),
    )) as { initiatives: { title: string }[] };
    expect(result.initiatives.map((one) => one.title)).toEqual([
      "Price the annual plan",
    ]);
  });

  it("is bounded, so a draft cannot outgrow what a team can finish", async () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      title: `Initiative ${index + 1}`,
      description: "",
      tasks: Array.from({ length: 9 }, (_, task) => `Task ${task + 1}`),
    }));
    const result = (await decompose(decomposer(many))) as {
      initiatives: { tasks: string[] }[];
    };
    expect(result.initiatives).toHaveLength(4);
    expect(result.initiatives[0]?.tasks).toHaveLength(6);
  });

  it("is nothing when nothing survives the checks", async () => {
    expect(
      await decompose(decomposer([{ title: " ", description: "", tasks: [] }])),
    ).toBeNull();
    expect(
      await decompose(
        drafterWith({
          async decomposeKeyResult() {
            throw new Error("the provider fell over");
          },
        }),
      ),
    ).toBeNull();
  });

  it("is nothing when an administrator switched it off", async () => {
    await switchOff(ASSIST_FEATURE_KEYS.decomposeKeyResult);
    expect(
      await decompose(
        decomposer([{ title: "Anything", description: "", tasks: [] }]),
      ),
    ).toBeNull();
  });

  it("is not-found for a key result that is not on this goal", async () => {
    await expect(
      decompose(
        decomposer([{ title: "Anything", description: "", tasks: [] }]),
        "0193a4c2-0000-7000-8000-000000000000",
      ),
    ).rejects.toThrow(/No such key result/);
  });

  it("is refused to a member who may not create work", async () => {
    const wb = await workerDb();
    // Down to `comment`: they may still read the goal, and the drafts exist
    // only to be created, which they may not do.
    await wb.admin.query(
      "update access_bindings set level = 40 where workspace_id = $1",
      [workspaceId],
    );
    await expect(
      decompose(
        decomposer([{ title: "Anything", description: "", tasks: [] }]),
      ),
    ).rejects.toThrow();
  });

  it("creates nothing", async () => {
    await decompose(
      decomposer([{ title: "Anything", description: "", tasks: ["One"] }]),
    );
    const wb = await workerDb();
    const counts = await wb.admin.query<{
      initiatives: string;
      tasks: string;
    }>(
      `select (select count(*) from initiatives) as initiatives,
              (select count(*) from tasks) as tasks`,
    );
    expect(counts.rows[0]).toEqual({ initiatives: "0", tasks: "0" });
  });
});
