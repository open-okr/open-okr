import { CATALOGUES, translate } from "@openokr/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AREAS, AreaTabs } from "../lib/area-tabs.tsx";

/**
 * The tabs inside an area (navigation-five-areas.md): Updates holds To do and
 * Activity, Goals holds OKRs and KPIs, Work holds Initiatives and the Board.
 * The routes do not move, so each tab is a link to the screen it always was.
 */
const t = (key: string, values?: Readonly<Record<string, string | number>>) =>
  translate(CATALOGUES.en, key, values, {
    kpi: { singular: "KPI", plural: "KPIs" },
  });

describe("an area's tabs", () => {
  it("names each area's screens and marks the open one", () => {
    const html = renderToStaticMarkup(
      <AreaTabs area="updates" current="/inbox" t={t} />,
    );
    expect(html).toContain('aria-label="Updates"');
    expect(html).toContain('href="/review"');
    expect(html).toMatch(
      /aria-current="page"[^>]*>Activity|href="\/inbox"[^>]*aria-current="page"/,
    );
    expect(html).toContain("To do");
  });

  it("covers the three areas that hold more than one screen", () => {
    expect(Object.keys(AREAS).sort()).toEqual(["goals", "updates", "work"]);
    expect(AREAS.goals.map((tab) => tab.href)).toEqual(["/goals", "/kpis"]);
    expect(AREAS.work.map((tab) => tab.href)).toEqual([
      "/initiatives",
      "/board",
    ]);
  });

  it("follows the workspace's word for KPIs", () => {
    const html = renderToStaticMarkup(
      <AreaTabs area="goals" current="/goals" t={t} />,
    );
    expect(html).toContain(">KPIs<");
  });
});
