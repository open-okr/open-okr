// @vitest-environment jsdom
import { REVIEW_STAGE_KEYS, REVIEW_STAGES } from "@openokr/method";
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// K2 (plan 0.8.1): the rail drew a passed stage's tick as the text "✓", which
// a font draws in its own colour and dark mode then drew wrong. It is now
// lucide's Check on the ok token, as K1 drew the input pack's.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../app/session/[id]/actions", () => ({
  addMinuteAction: vi.fn(),
  setStageNoteAction: vi.fn(),
}));

const { QuarterlyReview } = await import(
  "../app/session/[id]/quarterly-review"
);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the quarterly review's stage rail", () => {
  test("a passed stage draws an icon tick on the ok token, never a text glyph", async () => {
    const stages = REVIEW_STAGES.slice(0, 4).map((stage) => ({
      ...stage,
      minutes: 10,
    }));
    const keys = REVIEW_STAGE_KEYS.slice(0, 4);
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <QuarterlyReview
            sessionId="session-1"
            stages={stages}
            stageHasPanel={false}
            stageKeys={keys}
            currentStageKey={keys[2] ?? null}
            stageStartedAt={null}
            elapsed={{}}
            addedMinutes={{}}
            note={null}
            isFacilitator={false}
            isRunning={false}
            completion={{}}
          />
        </TranslationsProvider>,
      );
    });

    const rail = host.querySelector(
      '[aria-labelledby="review-stages-heading"]',
    );
    expect(rail).not.toBeNull();
    expect(rail?.textContent).not.toContain("✓");

    // Stages one and two are behind the room; three is running.
    const ticks = rail?.querySelectorAll("svg.lucide-check") ?? [];
    expect(ticks).toHaveLength(2);
    for (const tick of ticks) {
      expect(tick.getAttribute("aria-hidden")).toBe("true");
      expect(tick.parentElement?.className).toContain("bg-ok");
      expect(tick.parentElement?.className).toContain("text-on-ok");
      // The glyph was read out and the icon is not, so with no condition
      // to put in words the circle says it in hidden text.
      expect(tick.parentElement?.textContent).toBe("Done");
    }
  });
});
