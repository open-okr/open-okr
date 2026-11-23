// @vitest-environment jsdom
import { canonThresholds, defaultPractice } from "@openokr/method";
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftCoach } from "../app/cycle/draft-coach.tsx";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(title: string) {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="ms">
        <DraftCoach
          objective={{
            id: "goal",
            title,
            hasCycle: true,
            hasTimeframe: false,
            championId: "member",
            reviewerId: null,
            objectivesInUnit: 1,
            level: "team",
            kind: "aspirational",
          }}
          keyResults={[]}
          thresholds={canonThresholds()}
          practice={defaultPractice()}
          checkTitles={[{ id: "OBJ-1", title: "Outcome, not output" }]}
        />
      </TranslationsProvider>,
    );
  });
}

it("shows the Malay rule title and warning for an English objective with AI off", async () => {
  const request = vi.spyOn(globalThis, "fetch");
  await render("Launch the new onboarding flow");
  const rule = [...container.querySelectorAll("button")].find((one) =>
    one.textContent?.includes("OBJ-1"),
  );
  expect(rule?.textContent).toContain("Hasil, bukan keluaran");
  await act(async () => rule?.click());
  expect(container.textContent).toContain("Bermula dengan kata kerja keluaran");
  expect(container.textContent).toContain(
    "Objektif anda bermula dengan sesuatu yang hendak diserahkan",
  );
  expect(request).not.toHaveBeenCalled();
});

it("shows the Malay word-check notice for a Han objective with AI off", async () => {
  const request = vi.spyOn(globalThis, "fetch");
  await render(
    "让企业客户在第三季度末之前把满意度提高到百分之九十并且减少流失以及提升续约率",
  );
  expect(container.textContent).toContain(
    "Semakan perkataan hanya membaca bahasa Inggeris, jadi teks ini tidak melalui semakan tersebut.",
  );
  expect(request).not.toHaveBeenCalled();
});
