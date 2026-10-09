import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MockAIProvider } from "@openokr/adapters";
import { createProviderDrafter } from "@openokr/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The assists reach the browser, and only where a provider may run them
 * (completeness review M-09).
 *
 * Six assists were built and nothing in the browser called them, and the two
 * §2.4 promised were not built. What is proved here is the host's half:
 *
 * - `assistOffered` answers no with the provider off, with the egress
 *   controls withholding it (both are "no drafter"), and with the assist's
 *   own switch off, so no screen draws a button that can only fail;
 * - every server action hands the registry action the drafter the workspace
 *   has, built here on the mock driver, and hands it nothing with AI off;
 * - decomposition asks for the `deep` tier AI-NATIVE-PLAN §3.4 gives it;
 * - creating what a person kept from a decomposition runs as them, one row at
 *   a time, and names every refusal;
 * - every screen draws its affordance only behind the offered flag.
 *
 * What each action does with a drafter's answer is proved against a database
 * in `packages/core/test/work-assists.test.ts` and the assist suites beside
 * it, and what the drafter sends and refuses on the mock driver in
 * `packages/agents/test/work-assists-drafter.test.ts`.
 */

const callAction = vi.fn();
const checkFeatureAvailability = vi.fn();
const drafterFor = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
  checkFeatureAvailability: (...args: unknown[]) =>
    checkFeatureAvailability(...args),
}));
vi.mock("../lib/drafter", () => ({
  drafterFor: (...args: unknown[]) => drafterFor(...args),
}));
vi.mock("../lib/auth", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
  }),
}));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("../lib/instance-name", () => ({
  getInstanceName: async () => "OKR Goal",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { OperationError } = await import("@openokr/core");
const { assistOffered } = await import("../lib/assists");
const kpiDetail = await import("../app/kpis/[id]/actions.ts");
const kpiGrid = await import("../app/kpis/actions.ts");
const space = await import("../app/spaces/[id]/assist-actions.ts");
const goal = await import("../app/goals/[id]/assist-actions.ts");
const sessionActions = await import("../app/session/[id]/actions.ts");

/** A drafter on the deterministic mock driver, as the host would build one. */
const mockDrafter = () =>
  createProviderDrafter({
    provider: new MockAIProvider(),
    model: "mock-model",
    costCapUsd: 2,
    costInPerMillion: 1,
    costOutPerMillion: 2,
  });

beforeEach(() => {
  callAction.mockReset();
  checkFeatureAvailability.mockReset();
  drafterFor.mockReset();
  callAction.mockResolvedValue(null);
});

describe("whether an assist is offered", () => {
  it("is no with AI off, and the switch is not even asked", async () => {
    // No drafter is both "no provider" and "the egress controls let nothing
    // reach it": `drafterFor` answers null for either (M-10).
    drafterFor.mockResolvedValue(null);
    expect(await assistOffered("workspace-1", "assists.narrateTrend")).toBe(
      false,
    );
    expect(checkFeatureAvailability).not.toHaveBeenCalled();
  });

  it("is no when an administrator switched this assist off", async () => {
    drafterFor.mockResolvedValue(mockDrafter());
    checkFeatureAvailability.mockResolvedValue({ available: false });
    expect(await assistOffered("workspace-1", "assists.suggestKpi")).toBe(
      false,
    );
  });

  it("is yes with a drafter and the switch on", async () => {
    drafterFor.mockResolvedValue(mockDrafter());
    checkFeatureAvailability.mockResolvedValue({ available: true });
    expect(
      await assistOffered(
        "workspace-1",
        "assists.decomposeKeyResult",
        "deep",
        "user-1",
      ),
    ).toBe(true);
    // Asked about the reader, whose own key can be what makes it run (M-36).
    expect(drafterFor).toHaveBeenCalledWith("workspace-1", "deep", "user-1");
    expect(checkFeatureAvailability).toHaveBeenCalledWith("the pool", {
      workspaceId: "workspace-1",
      featureKey: "assists.decomposeKeyResult",
      defaultTier: "deep",
    });
  });
});

/** Every assist's server action, the registry action it calls, and its input. */
const ASSISTS: readonly {
  readonly name: string;
  readonly run: () => Promise<unknown>;
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly tier?: string;
}[] = [
  {
    name: "the trend narration",
    run: () => kpiDetail.narrateTrendAction("kpi-1"),
    action: "kpis.narrateTrend",
    input: { kpiId: "kpi-1" },
  },
  {
    name: "the KPI suggestion",
    run: () => kpiGrid.suggestKpiAction("Weekly active teams"),
    action: "kpis.suggest",
    input: { description: "Weekly active teams" },
  },
  {
    name: "the blocker summary",
    run: () => space.summariseBlockersAction("space-1"),
    action: "blockers.summarise",
    input: { spaceId: "space-1" },
  },
  {
    name: "the retrospective draft",
    run: () => goal.draftRetrospectiveAction("goal-1"),
    action: "goals.draftRetrospective",
    input: { goalId: "goal-1" },
  },
  {
    name: "the thread summary",
    run: () => goal.summariseThreadAction("goal-1"),
    action: "comments.summarise",
    input: { subjectType: "goal", subjectId: "goal-1" },
  },
  {
    name: "the decomposition",
    run: () => goal.decomposeKeyResultAction("goal-1", "kr-1"),
    action: "goals.decomposeKeyResult",
    input: { goalId: "goal-1", keyResultId: "kr-1" },
    tier: "deep",
  },
  {
    name: "the minutes write-up",
    run: () => sessionActions.draftMinutesAction("session-1"),
    action: "sessions.draftMinutes",
    input: { sessionId: "session-1" },
  },
];

describe("every assist's server action", () => {
  for (const assist of ASSISTS) {
    it(`${assist.name} hands ${assist.action} the workspace's drafter`, async () => {
      const drafter = mockDrafter();
      drafterFor.mockResolvedValue(drafter);
      await assist.run();

      // For the reader, so their own key answers them where they stored one
      // (completeness review M-36).
      expect(drafterFor).toHaveBeenCalledWith(
        "workspace-1",
        assist.tier ?? "balanced",
        "user-1",
      );
      const [context, action, input] = callAction.mock.calls[0] as [
        { drafter?: unknown; actor: { userId: string } },
        string,
        unknown,
      ];
      expect(action).toBe(assist.action);
      expect(input).toEqual(assist.input);
      // As the reader, with the drafter the mock driver backs.
      expect(context.actor.userId).toBe("user-1");
      expect(context.drafter).toBe(drafter);
    });

    it(`${assist.name} hands it no drafter with AI off`, async () => {
      drafterFor.mockResolvedValue(null);
      await assist.run();
      const [context] = callAction.mock.calls[0] as [Record<string, unknown>];
      expect("drafter" in context).toBe(false);
    });
  }
});

describe("creating what a person kept from a decomposition", () => {
  // Each description is the compact editor's document (guided-inputs §4.7).
  const words = (text: string) => ({
    type: "doc",
    content: [
      text === ""
        ? { type: "paragraph" }
        : { type: "paragraph", content: [{ type: "text", text }] },
    ],
  });

  it("creates each initiative as them, behind the key result, then its tasks", async () => {
    callAction.mockImplementation(async (_context, action: string) =>
      action === "initiatives.create" ? { id: "initiative-1" } : { id: "task" },
    );
    const created = await goal.createDecomposedWorkAction({
      goalId: "goal-1",
      keyResultId: "kr-1",
      spaceId: "space-1",
      initiatives: [
        {
          title: " Hand trials to finance ",
          description: words("A named owner."),
          tasks: ["Draft the handover note", "  "],
        },
        { title: "   ", description: words(""), tasks: ["Never created"] },
      ],
    });

    expect(created).toEqual({ initiatives: 1, tasks: 1, refused: [] });
    const calls = callAction.mock.calls.map(
      ([context, action, input]) =>
        [
          (context as { actor: { userId: string }; drafter?: unknown }).actor
            .userId,
          action,
          input,
        ] as const,
    );
    expect(calls[0]?.[0]).toBe("user-1");
    expect(calls[0]?.[1]).toBe("initiatives.create");
    expect(calls[0]?.[2]).toMatchObject({
      spaceId: "space-1",
      title: "Hand trials to finance",
      description: words("A named owner."),
      ownerId: "member-1",
      keyResultIds: ["kr-1"],
    });
    expect(calls[1]).toEqual([
      "user-1",
      "tasks.create",
      {
        spaceId: "space-1",
        title: "Draft the handover note",
        initiativeId: "initiative-1",
        keyResultId: "kr-1",
      },
    ]);
    // Blank rows are nothing, not refusals.
    expect(calls).toHaveLength(2);
    // And the write carries no drafter: nothing a model said is applied.
    const [writeContext] = callAction.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect("drafter" in writeContext).toBe(false);
  });

  it("names a refusal and carries on with the rest", async () => {
    callAction.mockImplementation(
      async (_context, action: string, input: { title: string }) => {
        if (action === "initiatives.create" && input.title === "Refused") {
          throw new OperationError("not_found", "No such space.");
        }
        return { id: `${input.title}-id` };
      },
    );
    const created = await goal.createDecomposedWorkAction({
      goalId: "goal-1",
      keyResultId: "kr-1",
      spaceId: "space-1",
      initiatives: [
        { title: "Refused", description: words(""), tasks: ["One"] },
        { title: "Kept", description: words(""), tasks: ["Two"] },
      ],
    });
    expect(created.initiatives).toBe(1);
    expect(created.tasks).toBe(1);
    expect(created.refused).toEqual([
      'goals.detail.decompose.refused {"title":"Refused","reason":"No such space."}',
    ]);
    // An empty description is no description, not an empty document.
    expect(callAction.mock.calls[2]?.[2]).not.toHaveProperty("description");
  });

  it("refuses a description over the panel's cap by name, and creates the rest", async () => {
    callAction.mockImplementation(async (_context, action: string) =>
      action === "initiatives.create" ? { id: "initiative-1" } : { id: "task" },
    );
    const created = await goal.createDecomposedWorkAction({
      goalId: "goal-1",
      keyResultId: "kr-1",
      spaceId: "space-1",
      initiatives: [
        { title: "Too long", description: words("x".repeat(1001)), tasks: [] },
        { title: "Exactly", description: words("x".repeat(1000)), tasks: [] },
      ],
    });
    expect(created.initiatives).toBe(1);
    expect(created.refused).toEqual([
      'goals.detail.decompose.refused {"title":"Too long","reason":"Keep it to 1000 characters. This has 1001."}',
    ]);
    // Nothing was sent for the refused one: the cap is held before the write.
    expect(
      callAction.mock.calls.map(
        ([, , input]) => (input as { title: string }).title,
      ),
    ).toEqual(["Exactly"]);
  });
});

describe("every screen draws its affordance only when offered", () => {
  const source = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  const GATES: readonly {
    readonly page: string;
    readonly flag: string;
    readonly component: string;
    readonly featureKey: string;
  }[] = [
    {
      page: "../app/kpis/[id]/page.tsx",
      flag: "narrationOffered",
      component: "<TrendNarration",
      featureKey: "RHYTHM_ASSIST_KEYS.narrateTrend",
    },
    {
      page: "../app/kpis/page.tsx",
      flag: "suggestionOffered",
      component: "<KpiSuggestion",
      featureKey: "RHYTHM_ASSIST_KEYS.suggestKpi",
    },
    {
      page: "../app/spaces/[id]/page.tsx",
      flag: "summaryOffered",
      component: "<BlockerSummary",
      featureKey: "RHYTHM_ASSIST_KEYS.summariseBlockers",
    },
    {
      page: "../app/session/[id]/minutes/page.tsx",
      flag: "writeUpOffered",
      component: "<MinutesWriteUp",
      featureKey: "REVIEW_ASSIST_KEYS.draftMinutes",
    },
    {
      page: "../app/goals/[id]/page.tsx",
      flag: "threadSummaryOffered",
      component: "<ThreadSummary",
      featureKey: "ASSIST_FEATURE_KEYS.summariseThread",
    },
    {
      page: "../app/goals/[id]/page.tsx",
      flag: "decomposeOffered",
      component: "<DecomposeKeyResult",
      featureKey: "ASSIST_FEATURE_KEYS.decomposeKeyResult",
    },
  ];

  for (const gate of GATES) {
    it(`${gate.component.slice(1)} sits behind ${gate.flag}`, () => {
      const page = source(gate.page);
      // The flag comes from `assistOffered` with this assist's own switch.
      expect(page).toContain(gate.featureKey);
      // A wrapper element between the two is allowed; anything longer is not
      // the flag guarding the component.
      expect(page).toMatch(
        new RegExp(`\\{${gate.flag} \\? [\\s\\S]{0,60}?${gate.component}`),
      );
      // And the component is drawn nowhere else on the page.
      expect(page.split(gate.component)).toHaveLength(2);
    });
  }

  it("hands the close form its flag", () => {
    const goalPage = source("../app/goals/[id]/page.tsx");
    expect(goalPage).toContain("REVIEW_ASSIST_KEYS.draftRetrospective");
    expect(goalPage).toContain("offered={retrospectiveOffered}");
  });

  it("offers no next-cycle proposals on the review, which drafts nothing now (P9-T22d)", () => {
    // Stage ten is Learnings: the review no longer drafts the next cycle, so
    // the assist that filled the draft form has no screen to sit on.
    const sessionPage = source("../app/session/[id]/page.tsx");
    expect(sessionPage).not.toContain("REVIEW_ASSIST_KEYS.proposeObjectives");
  });
});
