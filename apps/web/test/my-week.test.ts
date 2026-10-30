import { describe, expect, it } from "vitest";
import { myWeek, rhythmByTeam } from "../lib/my-week.ts";

/**
 * The role homes (OKRGoal UX review, backlog 12). A key result owner's home is
 * "My week": their goals as check-in cards, due first, each with the one
 * action that fits. The people who run the cycle also see each team's rhythm.
 */

const goal = (overrides: Record<string, unknown>) => ({
  id: "g",
  title: "Goal",
  champion: { id: "me", name: "Me" },
  spaceId: null as string | null,
  daysPastDue: -5 as number | null,
  nextCheckInOn: "2026-11-09" as string | null,
  closedAt: null as string | null,
  keyResults: [],
  ...overrides,
});

describe("my week", () => {
  it("holds only the goals the reader champions, due first", () => {
    const cards = myWeek(
      [
        goal({ id: "later", daysPastDue: -6 }),
        goal({ id: "theirs", champion: { id: "them", name: "Them" } }),
        goal({ id: "overdue", daysPastDue: 3 }),
        goal({ id: "closed", closedAt: "2026-10-01" }),
      ] as never,
      "me",
    );
    expect(cards.map((card) => card.goal.id)).toEqual(["overdue", "later"]);
  });

  it("offers a check-in when due and an update otherwise", () => {
    const [due, ahead, unscheduled] = myWeek(
      [
        goal({ id: "due", daysPastDue: -1 }),
        goal({ id: "ahead", daysPastDue: -6 }),
        goal({ id: "unscheduled", daysPastDue: null, nextCheckInOn: null }),
      ] as never,
      "me",
    );
    expect(due?.action).toBe("checkIn");
    expect(due?.href).toBe("/check-in?goal=due");
    expect(ahead?.action).toBe("update");
    expect(ahead?.href).toBe("/check-in?goal=ahead&update=1");
    expect(unscheduled?.action).toBe("update");
  });
});

describe("rhythm by team", () => {
  it("counts each space's goals that are not past due", () => {
    const rows = rhythmByTeam(
      [
        goal({ id: "a", spaceId: "s1", daysPastDue: 0 }),
        goal({ id: "b", spaceId: "s1", daysPastDue: 2 }),
        goal({ id: "c", spaceId: "s2", daysPastDue: -3 }),
        goal({ id: "d", spaceId: null, daysPastDue: 4 }),
      ] as never,
      [
        { id: "s1", name: "Support" },
        { id: "s2", name: "Platform" },
      ],
    );
    // Weakest first: Support has one of two current, Platform all of one.
    expect(rows).toEqual([
      { spaceId: "s1", name: "Support", current: 1, total: 2 },
      { spaceId: "s2", name: "Platform", current: 1, total: 1 },
    ]);
  });
});
