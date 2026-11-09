// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AlignmentReading } from "../app/goals/alignment-panel.tsx";

/**
 * The re-parent button follows the read (plan 0.7.0 A6, design
 * `alignment-engine.md` §9).
 *
 * The button used to be drawn for every `relink`, and the action refused the
 * one with no new parent, so the panel offered a click that could only fail.
 * It now follows `oneClickApplicable`, which the read derives with the same
 * function the action asks. Which findings say true is proved against real
 * rows in `packages/core` (`semantic-sweep.test.ts`); what is checked here is
 * that the panel draws exactly what the field says.
 */

vi.mock("../app/goals/alignment-actions.ts", () => ({
  applyFinding: vi.fn(),
  dismissFinding: vi.fn(),
}));

const { AlignmentPanel } = await import("../app/goals/alignment-panel.tsx");

let root: Root;
let container: HTMLDivElement;

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
});

type Finding = AlignmentReading["findings"][number];

const finding = (overrides: Partial<Finding>): Finding => ({
  id: "f",
  ruleKey: "",
  severity: "medium",
  kind: "relink",
  reason: "This supports the mid-market objective, not its own.",
  source: "coach",
  subjectGoalId: "g",
  subjectGoalTitle: "Grow mid-market revenue",
  oneClickApplicable: true,
  ...overrides,
});

const reading = (findings: readonly Finding[]): AlignmentReading => ({
  score: 100,
  band: "healthy",
  threshold: 90,
  watchThreshold: 80,
  anchored: true,
  measured: 1,
  counted: 1,
  uncounted: [],
  findings,
});

/** The panel, opened on its Review tab where the Coach's findings are. */
async function review(findings: readonly Finding[], canEdit = true) {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <AlignmentPanel
          alignment={reading(findings)}
          canEdit={canEdit}
          onOpen={() => undefined}
        />
      </TranslationsProvider>,
    );
  });
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (candidate) => candidate.textContent === "Review",
  );
  if (!(tab instanceof HTMLElement)) {
    throw new Error("No Review tab");
  }
  await act(async () => {
    tab.click();
  });
}

const buttons = (text: string) =>
  [...container.querySelectorAll("button")].filter(
    (button) => button.textContent === text,
  );

describe("the re-parent button", () => {
  test("is drawn for a finding the read says one click applies", async () => {
    await review([finding({})]);
    expect(buttons("Re-parent")).toHaveLength(1);
    expect(buttons("Dismiss")).toHaveLength(1);
  });

  test("is not drawn for a relink the read says one click does not apply", async () => {
    // A relink with no new parent: the action refuses it, so the panel must
    // not offer it. Dismissing is still a decision somebody can make.
    await review([finding({ oneClickApplicable: false })]);
    expect(buttons("Re-parent")).toHaveLength(0);
    expect(buttons("Dismiss")).toHaveLength(1);
  });

  test("is drawn by the field, not by the kind", async () => {
    await review([
      finding({ id: "a", kind: "conflict", oneClickApplicable: false }),
      finding({ id: "b", kind: "gap", oneClickApplicable: false }),
      finding({ id: "c", kind: "relink", oneClickApplicable: true }),
    ]);
    expect(buttons("Re-parent")).toHaveLength(1);
    expect(buttons("Dismiss")).toHaveLength(3);
  });

  test("is not drawn for a reader who cannot edit", async () => {
    await review([finding({})], false);
    expect(buttons("Re-parent")).toHaveLength(0);
  });
});
