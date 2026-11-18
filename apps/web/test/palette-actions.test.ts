import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * What the palette asks the server, and what it passes (completeness review
 * M-21).
 *
 * **Semantic search was never called.** `search.query` has blended semantic
 * results since P5-T13 when its caller hands it an embedding function, and the
 * palette never handed it one. The Related group is now its own server action,
 * so these are the claims that matter: with the provider off nothing is asked
 * of a model, with it on the embedding function reaches the read, and the fast
 * answer never waits on either.
 *
 * The reads themselves, and that each one filters by who is asking, are proved
 * against a database in `packages/core/test/search-palette.test.ts`.
 */

class OperationError extends Error {}

const callAction = vi.fn();
vi.mock("@openokr/core", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
  OperationError,
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1" },
  }),
}));
const embedFor = vi.fn();
vi.mock("../lib/embedder", () => ({
  embedFor: (workspaceId: string) => embedFor(workspaceId),
}));

const { paletteRecentAction, paletteRelatedAction, paletteSearchAction } =
  await import("../app/search/actions.ts");

const KPI = "11111111-1111-4111-8111-111111111111";
const GOAL = "22222222-2222-4222-8222-222222222222";

const hit = (entityId: string, semantic: boolean) => ({
  entityType: "goal",
  entityId,
  title: semantic ? "Glacier retention" : "Aurora launch",
  snippet: "…",
  href: `/goals/${entityId}`,
  rank: 1,
  semantic,
});

beforeEach(() => {
  callAction.mockReset();
  embedFor.mockReset();
});

describe("the fast answer", () => {
  test("asks the jump by code, the jump by name and full text, and no model", async () => {
    callAction.mockImplementation(async (_context, name: string) => {
      if (name === "search.jump") {
        return {
          entityType: "kpi",
          entityId: KPI,
          title: "Weekly signups",
          href: `/kpis/${KPI}`,
        };
      }
      if (name === "search.entities") {
        return [
          // The same KPI again, found by its name as well as its code.
          {
            entityType: "kpi",
            entityId: KPI,
            title: "Weekly signups",
            href: `/kpis/${KPI}`,
          },
          {
            entityType: "goal",
            entityId: GOAL,
            title: "Aurora launch",
            href: `/goals/${GOAL}`,
          },
        ];
      }
      return [hit(GOAL, false)];
    });

    const answer = await paletteSearchAction("  Aurora  ");

    expect(callAction.mock.calls.map((call) => call[1]).sort()).toEqual([
      "search.entities",
      "search.jump",
      "search.query",
    ]);
    for (const [context] of callAction.mock.calls) {
      expect(context).not.toHaveProperty("embed");
    }
    expect(embedFor).not.toHaveBeenCalled();
    // The code's own answer first, and not a second time under its name.
    expect(answer.goTo.map((one) => one.entityId)).toEqual([KPI, GOAL]);
    expect(answer.hits.map((one) => one.href)).toEqual([`/goals/${GOAL}`]);
    expect(answer.error).toBeNull();
  });

  test("asks nothing for an empty phrase", async () => {
    expect(await paletteSearchAction("   ")).toEqual({
      goTo: [],
      hits: [],
      error: null,
    });
    expect(callAction).not.toHaveBeenCalled();
  });

  test("hands a refusal back as a sentence", async () => {
    callAction.mockRejectedValue(new OperationError("No such workspace."));
    const answer = await paletteSearchAction("aurora");
    expect(answer.error).toBe("No such workspace.");
  });
});

describe("the Related group", () => {
  test("with the provider off, asks nothing at all", async () => {
    embedFor.mockResolvedValue(undefined);
    expect(await paletteRelatedAction("retention")).toEqual([]);
    expect(embedFor).toHaveBeenCalledWith("workspace-1");
    expect(callAction).not.toHaveBeenCalled();
  });

  test("with it on, hands the embedding to the read and keeps what full text missed", async () => {
    const embed = vi.fn();
    embedFor.mockResolvedValue(embed);
    callAction.mockResolvedValue([hit(GOAL, false), hit(KPI, true)]);

    const related = await paletteRelatedAction("retention");

    expect(callAction).toHaveBeenCalledTimes(1);
    const [context, name, input] = callAction.mock.calls[0] ?? [];
    expect(name).toBe("search.query");
    expect(context).toMatchObject({ workspaceId: "workspace-1", embed });
    expect(input).toEqual({ text: "retention", limit: 12 });
    expect(related.map((one) => one.entityId)).toEqual([KPI]);
  });

  test("does not call a model for one or two letters", async () => {
    expect(await paletteRelatedAction("re")).toEqual([]);
    expect(embedFor).not.toHaveBeenCalled();
  });

  test("leaves the palette as it would be with no provider when the provider fails", async () => {
    embedFor.mockResolvedValue(vi.fn());
    callAction.mockRejectedValue(new Error("provider unreachable"));
    expect(await paletteRelatedAction("retention")).toEqual([]);
  });
});

describe("a scoped tab (work-layer.md §5.1, G2-D6)", () => {
  test("narrows the jump, the name search and full text to its kind", async () => {
    callAction.mockResolvedValue([]);
    await paletteSearchAction("aurora", "tasks");

    const inputs = Object.fromEntries(
      callAction.mock.calls.map((call) => [call[1], call[2]]),
    );
    expect(inputs["search.entities"]).toEqual({
      text: "aurora",
      limit: 8,
      kinds: ["task"],
    });
    expect(inputs["search.query"]).toEqual({
      text: "aurora",
      limit: 12,
      entityTypes: ["task"],
    });
    expect(inputs["search.jump"]).toEqual({
      shortId: "aurora",
      kinds: ["task"],
    });
  });

  test("the people tab has no full-text or short-code half, people are not indexed", async () => {
    callAction.mockResolvedValue([]);
    await paletteSearchAction("ada", "people");
    expect(callAction.mock.calls.map((call) => call[1])).toEqual([
      "search.entities",
    ]);
    expect(callAction.mock.calls[0]?.[2]).toEqual({
      text: "ada",
      limit: 8,
      kinds: ["person"],
    });
  });

  test("an unknown tab from the browser means All", async () => {
    callAction.mockResolvedValue([]);
    await paletteSearchAction("aurora", "nonsense");
    const entities = callAction.mock.calls.find(
      (call) => call[1] === "search.entities",
    );
    expect(entities?.[2]).toEqual({ text: "aurora", limit: 8 });
  });

  test("Related is asked for the same kind, and not at all for people", async () => {
    embedFor.mockResolvedValue(vi.fn());
    callAction.mockResolvedValue([]);
    await paletteRelatedAction("retention", "tasks");
    expect(callAction.mock.calls[0]?.[2]).toEqual({
      text: "retention",
      limit: 12,
      entityTypes: ["task"],
    });

    callAction.mockClear();
    expect(await paletteRelatedAction("retention", "people")).toEqual([]);
    expect(callAction).not.toHaveBeenCalled();
  });
});

describe("the Recent group", () => {
  test("sends only what the read would accept, and hands back what it kept", async () => {
    callAction.mockResolvedValue([
      {
        entityType: "task",
        entityId: GOAL,
        title: "Pricing copy",
        href: `/tasks/${GOAL}`,
      },
    ]);
    const found = await paletteRecentAction([
      { kind: "task", id: GOAL },
      // A kind the read does not know would refuse the whole list.
      { kind: "document", id: KPI },
    ]);

    expect(callAction.mock.calls[0]?.[1]).toBe("search.recent");
    expect(callAction.mock.calls[0]?.[2]).toEqual({
      refs: [{ kind: "task", id: GOAL }],
    });
    expect(found?.map((one) => one.entityId)).toEqual([GOAL]);
  });

  test("answers null on a failure, so the browser prunes nothing", async () => {
    callAction.mockRejectedValue(new Error("down"));
    expect(await paletteRecentAction([])).toBeNull();
  });
});
