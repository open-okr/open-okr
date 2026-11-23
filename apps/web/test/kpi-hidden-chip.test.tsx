import { TranslationsProvider } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LinkedKpiChip } from "../app/goals/linked-kpi-chip.tsx";

const inEnglish = (node: ReactNode) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">{node}</TranslationsProvider>,
  );

describe("LinkedKpiChip (0.10.0 K7 R16)", () => {
  const kpiId = "00000000-0000-4000-8000-000000000001";

  test("visible KPI renders chip with KPI title and link to the KPI detail", () => {
    const html = inEnglish(
      <LinkedKpiChip
        kpiId={kpiId}
        kpi={{ id: kpiId, title: "Operating Margin" }}
      />,
    );
    expect(html).toContain("Operating Margin");
    expect(html).toContain(`href="/kpis/${kpiId}"`);
  });

  test("R16 hidden chip shows 'A KPI you cannot see' with no title and no link", () => {
    const html = inEnglish(<LinkedKpiChip kpiId={kpiId} kpi={null} />);
    expect(html).toContain("A KPI you cannot see");
    expect(html).not.toContain("Operating Margin");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");
  });
});
