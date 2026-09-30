import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TranslationsProvider } from "@openokr/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { SectionBoundary, SectionFailed } from "../lib/section-boundary.tsx";
import { SectionLoading } from "../lib/segment-loading.tsx";
import { readScreen, withMessages } from "./screen-text.ts";

/**
 * The space home shows the space's goals and its KPI trees (completeness
 * review M-22).
 *
 * The reads, and who they refuse, are proved against a real database in
 * `packages/core` (`space-kpi-trees.test.ts`, and `goals.list`'s own suite for
 * the goals). What is checked here is the screen: that it draws both with the
 * components the Work Map and S-18 already use rather than new ones, that each
 * streams behind its own skeleton and error card, and what each says when
 * there is nothing to show.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const source = (path: string) => readFileSync(at(path), "utf8");

const page = source("../app/spaces/[id]/page.tsx");
const work = source("../app/spaces/[id]/space-work.tsx");
const workText = withMessages(
  readScreen(at("../app/spaces/[id]/space-work.tsx")),
);
const treeScreen = source("../app/kpis/trees/page.tsx");
const home = source("../app/(home)/page.tsx");

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">{node}</TranslationsProvider>,
  );

describe("the space home's own work", () => {
  test("reads the space's goals and KPI trees through the access-aware reads", () => {
    expect(work).toContain('callAction(context, "goals.list"');
    expect(work).toMatch(/spaceId,\s*includeClosed: false/);
    expect(work).toContain('callAction(context, "kpis.spaceTrees"');
  });

  test("draws them with the Work Map's table and S-18's rows, not new ones", () => {
    expect(work).toContain("<GoalTable");
    expect(work).toContain("goalTreeNodes(t, goals)");
    expect(work).toContain("<KpiTreeRows");
    // One tree order and one row drawing, shared with the screens they came
    // from rather than copied beside them.
    expect(home).toContain("goalTreeNodes(t, goals)");
    expect(home).not.toContain("function flatten(");
    expect(treeScreen).toContain("<KpiTreeRows");
    expect(treeScreen).not.toContain("function flatten(");
  });

  test("streams each card behind its own skeleton and error card", () => {
    const goals = page.indexOf("<SpaceGoals");
    const kpis = page.indexOf("<SpaceKpiTrees");
    expect(goals).toBeGreaterThan(0);
    expect(kpis).toBeGreaterThan(goals);
    for (const position of [goals, kpis]) {
      const before = page.slice(0, position);
      expect(
        before.lastIndexOf("<Suspense fallback={<SectionLoading"),
      ).toBeGreaterThan(before.lastIndexOf("</SectionBoundary>"));
      expect(before.lastIndexOf("<SectionBoundary")).toBeGreaterThan(
        before.lastIndexOf("</SectionBoundary>"),
      );
    }
    expect(page).toContain('headingKey="spaces.detail.goalsFailed"');
    expect(page).toContain('headingKey="spaces.detail.kpiTreesFailed"');
  });

  test("says what an empty card means without claiming more than the reader can see", () => {
    expect(workText).toContain("This space has no open goals you can see yet.");
    expect(workText).toContain("No KPIs belong to this space yet.");
    expect(workText).toContain("Open in the Work Map");
    expect(work).toContain("href={`/?scope=");
  });

  test("names the space and the KPI by their term holes, so a rename reaches them", () => {
    const en = JSON.parse(
      source("../../../packages/ui/src/i18n/messages/en.json"),
    ) as Record<string, string>;
    for (const key of [
      "spaces.detail.noGoalsYouCanSee",
      "spaces.detail.noKpisYet",
      "spaces.detail.goalsFailed",
      "spaces.detail.kpiTreesFailed",
    ]) {
      expect(en[key]).toMatch(/\{termSpace(Lower)?\}/);
      expect(en[key]).not.toMatch(/\bspace\b/i);
    }
  });
});

describe("a guest on the space home", () => {
  test("does not take the page down by being refused the workspace-wide reads", () => {
    // A guest holds nothing on the workspace itself, so these two refuse
    // them. Only a not-found becomes the default; anything else still throws.
    expect(page).toContain(
      'callAction(actor, "settings.readForMember", {}).catch(refusedAsNull)',
    );
    expect(page).toContain(
      'callAction(actor, "rhythm.read", {}).catch(refusedAsNull)',
    );
    expect(page).toMatch(
      /error instanceof OperationError && error\.code === "not_found"\) \{\s*return null;\s*\}\s*throw error;/,
    );
    expect(page).toContain("canonThresholds()");
    expect(page).toContain('feedSettings?.settings.timezone ?? "UTC"');
  });
});

describe("a card still loading", () => {
  test("is a busy skeleton with no words in it", () => {
    const html = render(<SectionLoading rows={2} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-testid="section-loading"');
    expect(html.match(/animate-pulse/g)).toHaveLength(3);
  });
});

describe("a card that failed", () => {
  test("names what failed, offers a retry and gives the reference", () => {
    const html = render(
      <SectionFailed
        headingKey="spaces.detail.goalsFailed"
        digest="abc123"
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("We could not load the goals of this space");
    expect(html).toContain("Try again");
    expect(html).toContain("abc123");
  });

  test("replaces only its own children once they throw", () => {
    const boundary = new SectionBoundary({
      headingKey: "spaces.detail.kpiTreesFailed",
      children: <p>the trees</p>,
    });
    expect(render(boundary.render())).toContain("the trees");

    boundary.state = SectionBoundary.getDerivedStateFromError(
      new Error("the read failed"),
    );
    const html = render(boundary.render());
    expect(html).not.toContain("the trees");
    expect(html).toContain("We could not load the KPI trees of this space");
  });
});
