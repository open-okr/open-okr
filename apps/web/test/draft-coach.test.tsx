// @vitest-environment jsdom
import { canonThresholds, defaultPractice } from "@openokr/method";
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  type CoachKeyResult,
  type CoachObjective,
  DraftCoach,
} from "../app/cycle/draft-coach.tsx";

/**
 * The Draft Coach by kind (METHOD.md §3.2, P9-T11b-c).
 *
 * KR-6 judges an aspirational set's average confidence and leaves a committed
 * one alone, because high confidence is right for a commitment; a committed
 * key result below the floor is the one thing said of it instead.
 */

let root: Root;
let container: HTMLDivElement;

const objective = (kind: CoachObjective["kind"]): CoachObjective => ({
  id: "g",
  title: "Answer every enterprise ticket inside one working day",
  hasCycle: true,
  hasTimeframe: false,
  championId: "m",
  reviewerId: null,
  objectivesInUnit: 1,
  level: "team",
  kind,
});

const keyResult = (confidence: number): CoachKeyResult => ({
  id: `k${confidence}`,
  title: "Enterprise tickets closed in a day from 60% to 95%",
  baseline: 60,
  target: 95,
  dueOn: "2027-03-31",
  ownerId: "m",
  indicatorType: "lagging",
  direction: "increase",
  confidence,
  keyResultKind: "metric",
});

async function render(kind: CoachObjective["kind"], confidences: number[]) {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <DraftCoach
          objective={objective(kind)}
          keyResults={confidences.map(keyResult)}
          thresholds={canonThresholds()}
          practice={defaultPractice()}
          // No titles, so each verdict is shown by its id, which is what
          // these assertions read.
          checkTitles={[]}
        />
      </TranslationsProvider>,
    );
  });
}

const floor = () => container.querySelector('[data-testid="committed-floor"]');
const chips = () => container.textContent ?? "";

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

describe("the draft coach by kind", () => {
  test("calls a near-certain aspirational set out, and leaves a near-certain commitment alone", async () => {
    await render("aspirational", [0.95, 1]);
    expect(chips()).toContain("KR-6");
    await render("committed", [0.95, 1]);
    expect(chips()).not.toContain("KR-6");
    expect(floor()).toBeNull();
  });

  test("says a commitment drafted below the floor is a risk", async () => {
    await render("committed", [0.9, 0.4]);
    expect(floor()?.textContent).toBe(
      "A commitment nobody believes in is a risk. Escalate now, or make it aspirational",
    );
    await render("aspirational", [0.9, 0.4]);
    expect(floor()).toBeNull();
  });
});
