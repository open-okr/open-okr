import { CATALOGUES, translate } from "@openokr/ui";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The Work Map reads the stored alignment score (plan 0.7.0 D2, design
 * `alignment-engine.md` §10).
 *
 * It called `alignment.read` on every load for two things, the score and its
 * band, so the busiest screen paid for the whole graph. It now reads
 * `alignment.score`, one row. What that read returns, and that it equals the
 * graph's answer, is proved against a real database in `packages/core`
 * (`alignment-scores.test.ts`); what is checked here is which read the
 * screen asks for and that the header shows its answer.
 */

const CYCLE = "11111111-1111-4111-8111-111111111111";
const SPACE = "22222222-2222-4222-8222-222222222222";

const callAction = vi.fn();

vi.mock("@openokr/core", () => ({
  ACCESS_LEVELS: { view: 10, comment: 40, edit: 70, full: 100 },
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("../lib/access", () => ({ workspaceReaderLevel: async () => 70 }));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
    locale: "en",
  }),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: {
      workspaceId: "workspace-1",
      memberId: "member-1",
      name: "Northwind",
    },
  }),
}));
// The screen's children are drawn elsewhere and tested there. Stubbed so the
// screen's own reads are all this file exercises.
vi.mock("../app/goal-nodes.ts", () => ({ goalTreeNodes: () => [] }));
vi.mock("../app/work-map.tsx", () => ({ WorkMap: () => null }));
vi.mock("../app/work-map-header.tsx", () => ({
  WorkMapContextStrip: () => null,
  WorkMapHeader: () => null,
  WorkMapScopeTabs: () => null,
}));

const { WorkMapScreen } = await import("../app/work-map-screen.tsx");
const { WorkMapHeader } = await import("../app/work-map-header.tsx");

const READS: Readonly<Record<string, unknown>> = {
  "people.readOwnTour": { finished: true },
  "cycles.list": [{ id: CYCLE, name: "Q4" }],
  "cycles.current": { id: CYCLE },
  "spaces.list": [{ id: SPACE, name: "Revenue", isCompany: false }],
  "goals.list": { goals: [] },
  "workflow.read": null,
  "alignment.score": {
    score: 82,
    band: "watch",
    threshold: 90,
    watchThreshold: 80,
    breakdown: {
      measured: 50,
      withParent: 40,
      standingAlone: 1,
      unaligned: 9,
      anchored: true,
    },
    computedAt: "2026-11-09T08:00:00.000Z",
  },
};

beforeEach(() => {
  callAction.mockReset();
  callAction.mockImplementation(async (_context: unknown, name: string) => {
    if (name === "alignment.read") {
      throw new Error("The Work Map must not compute the alignment graph.");
    }
    if (!(name in READS)) {
      throw new Error(`Unexpected read ${name}`);
    }
    return READS[name];
  });
});

/** Every element in a tree, depth first, so a child's props can be read. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) {
    return node.flatMap(elements);
  }
  if (!isValidElement(node)) {
    return [];
  }
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

const asked = (name: string) =>
  callAction.mock.calls
    .filter(([, called]) => called === name)
    .map(([, , input]) => input);

describe("the Work Map's alignment figure", () => {
  test("reads the stored score for the company tree, never the graph", async () => {
    const screen = await WorkMapScreen({ query: {}, basePath: "/map" });

    expect(asked("alignment.score")).toEqual([{ cycleId: CYCLE }]);
    expect(asked("alignment.read")).toEqual([]);

    const header = elements(screen).find(
      (element) => element.type === WorkMapHeader,
    );
    if (!header) {
      throw new Error("The Work Map draws no header.");
    }
    expect(
      (header.props as { stats: Record<string, unknown> }).stats,
    ).toMatchObject({ alignmentScore: 82, alignmentBand: "watch" });
  });

  test("reads one space's stored score on its tab", async () => {
    await WorkMapScreen({ query: { scope: SPACE }, basePath: "/map" });
    expect(asked("alignment.score")).toEqual([
      { cycleId: CYCLE, spaceId: SPACE },
    ]);
  });
});
