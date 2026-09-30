import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TranslationsProvider } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { StudioNode } from "../app/goals/studio/canvas.tsx";

/**
 * Taking a dependency apart in the alignment studio (completeness review
 * M-35).
 *
 * Linking two goals was one click on the canvas and removing the link was
 * nowhere. `goals.removeDependency` existed, and the action-coverage test
 * excused it as "removed through the studio's own canvas write", a write that
 * never existed. The details panel now lists the selected goal's dependencies
 * by title, because a line on a canvas is not something a keyboard can pick,
 * and each carries its Remove.
 */

vi.mock("../app/goals/studio/actions.ts", () => ({
  applyFinding: vi.fn(),
  dismissFinding: vi.fn(),
  linkGoals: vi.fn(),
  unlinkGoals: vi.fn(),
}));

const { Studio } = await import("../app/goals/studio/studio.tsx");

const node = (id: string, title: string): StudioNode => ({
  id,
  title,
  level: "company",
  owner: "Priya",
  parentGoalId: null,
  keyResultCount: 2,
  dependencyCount: 1,
  health: "on_track",
  progressPct: 40,
  unaligned: false,
  closed: false,
});

const NODES = [
  node("00000000-0000-4000-8000-000000000001", "Grow retention"),
  node("00000000-0000-4000-8000-000000000002", "Ship the mobile app"),
];
const EDGE = {
  id: "00000000-0000-4000-8000-0000000000aa",
  from: NODES[0]?.id ?? "",
  to: NODES[1]?.id ?? "",
};

const render = (element: ReactNode) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">{element}</TranslationsProvider>,
  );

const studio = (props: { edges: readonly (typeof EDGE)[]; canEdit: boolean }) =>
  render(
    <Studio
      nodes={NODES}
      edges={props.edges}
      findings={[]}
      score={80}
      healthy
      threshold={70}
      progressMax={100}
      canEdit={props.canEdit}
    />,
  );

describe("a dependency in the studio", () => {
  test("is listed on the selected goal by the other goal's title, with its Remove", () => {
    const html = studio({ edges: [EDGE], canEdit: true });
    expect(html).toContain("Ship the mobile app");
    expect(html).toContain(`href="/goals/${EDGE.to}"`);
    expect(html).toContain(
      'aria-label="Remove the dependency on Ship the mobile app"',
    );
  });

  test("offers no Remove to somebody who cannot edit", () => {
    const html = studio({ edges: [EDGE], canEdit: false });
    expect(html).toContain("Ship the mobile app");
    expect(html).not.toContain("Remove the dependency on");
  });

  test("says so when the goal has none", () => {
    const html = studio({ edges: [], canEdit: true });
    expect(html).toContain(
      "No dependencies. Link two goals on the canvas to add one.",
    );
  });

  test("removes through goals.removeDependency, the same write either end may make", () => {
    const actions = readFileSync(
      fileURLToPath(new URL("../app/goals/studio/actions.ts", import.meta.url)),
      "utf8",
    );
    expect(actions).toMatch(
      /export async function unlinkGoals[\s\S]*?"goals\.removeDependency", \{ id: dependencyId \}/,
    );
  });
});
