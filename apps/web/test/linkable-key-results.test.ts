import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which key results a picker offers (plan 0.8.0 I1, I1-Q1): those of open
 * objectives in every cycle being planned or running, quarterly and annual,
 * that the reader can see. The Board, "Add an initiative", the initiative's
 * page and the objective page all ask this one helper.
 */

const callAction = vi.fn();
vi.mock("@openokr/core", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { linkableKeyResults } = await import("../lib/linkable-key-results");

// Newest first, as `cycles.list` answers: next quarter, being planned, leads.
const CYCLES = [
  { id: "q-next", name: "Q1 2027", status: "planning", mode: "quarterly" },
  { id: "y-now", name: "2026", status: "active", mode: "annual" },
  { id: "q-now", name: "Q4 2026", status: "active", mode: "quarterly" },
  { id: "q-ending", name: "Q3 2026", status: "closing", mode: "quarterly" },
  { id: "q-old", name: "Q2 2026", status: "closed", mode: "quarterly" },
];

const GOALS: Record<string, unknown[]> = {
  "q-now": [
    {
      title: "Make activation the reason teams stay",
      keyResults: [{ id: "kr-1", title: "Activation reaches sixty percent" }],
    },
  ],
  "y-now": [
    {
      title: "Lead the market",
      keyResults: [{ id: "kr-2", title: "Market share reaches a third" }],
    },
  ],
  "q-next": [
    {
      title: "Open the second region",
      keyResults: [{ id: "kr-3", title: "Ten customers in the region" }],
    },
  ],
  "q-ending": [
    { title: "Ending", keyResults: [{ id: "kr-x", title: "Not offered" }] },
  ],
  "q-old": [
    { title: "Closed", keyResults: [{ id: "kr-y", title: "Not offered" }] },
  ],
};

const context = {
  pool: {} as never,
  workspaceId: "w",
  actor: { kind: "human" as const, userId: "u" },
};

beforeEach(() => {
  callAction.mockReset();
  callAction.mockImplementation(
    async (_context: unknown, name: string, input: { cycleId?: string }) => {
      if (name === "cycles.list") {
        return CYCLES;
      }
      if (name === "goals.list") {
        expect(input).toMatchObject({ includeClosed: false });
        return { goals: GOALS[input.cycleId as string] ?? [] };
      }
      throw new Error(`Unexpected read ${name}`);
    },
  );
});

describe("the key results a picker offers", () => {
  it("are those of every cycle being planned or running, the running quarter first", async () => {
    expect(await linkableKeyResults(context)).toEqual([
      {
        id: "kr-1",
        title: "Activation reaches sixty percent",
        goalTitle: "Make activation the reason teams stay",
        cycleName: "Q4 2026",
      },
      {
        id: "kr-2",
        title: "Market share reaches a third",
        goalTitle: "Lead the market",
        cycleName: "2026",
      },
      {
        id: "kr-3",
        title: "Ten customers in the region",
        goalTitle: "Open the second region",
        cycleName: "Q1 2027",
      },
    ]);
  });

  it("never reads a cycle that is closing or closed", async () => {
    await linkableKeyResults(context);
    const read = callAction.mock.calls
      .filter((call) => call[1] === "goals.list")
      .map((call) => (call[2] as { cycleId: string }).cycleId);
    expect(read).toEqual(["q-now", "y-now", "q-next"]);
  });
});
