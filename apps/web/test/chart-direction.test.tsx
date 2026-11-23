// @vitest-environment jsdom
import { DirectionProvider } from "@base-ui-components/react/direction-provider";
import { Bar, TranslationsProvider } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { RowSparkline } from "../app/kpis/grid-extras.tsx";

function chartIn(direction: "ltr" | "rtl", chart: ReactNode) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <div dir={direction}>
      <DirectionProvider direction={direction}>
        <TranslationsProvider locale="en">{chart}</TranslationsProvider>
      </DirectionProvider>
    </div>,
  );
  return host;
}

describe("chart direction (languages §9)", () => {
  test("a progress fill leaves the unfilled space at the inline end in RTL", () => {
    const chart = chartIn("rtl", <Bar value={40} />);
    const fill = chart.querySelector<HTMLElement>('[role="progressbar"] span');
    expect(fill?.style.width).toBe("40%");
    expect(fill?.style.marginInlineEnd).toBe("auto");
  });

  test("a sparkline reverses time while keeping its value axis", () => {
    const sparkline = (
      <RowSparkline
        state="healthy"
        records={[
          { periodStart: "2026-01-01", actualValue: 1 },
          { periodStart: "2026-02-01", actualValue: 3 },
        ]}
      />
    );
    const ltr = chartIn("ltr", sparkline);
    const rtl = chartIn("rtl", sparkline);

    expect(ltr.querySelector("polyline")?.getAttribute("points")).toBe(
      "2.0,21.0 98.0,3.0",
    );
    expect(rtl.querySelector("polyline")?.getAttribute("points")).toBe(
      "98.0,21.0 2.0,3.0",
    );
    expect(rtl.querySelector("circle")?.getAttribute("cx")).toBe("2");
    expect(rtl.querySelector("circle")?.getAttribute("cy")).toBe("3");
  });
});
