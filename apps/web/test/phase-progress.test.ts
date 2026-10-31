import { CATALOGUES, translate } from "@openokr/ui";
import { describe, expect, it } from "vitest";
import { phaseProgress } from "../lib/phase-progress.ts";

/**
 * The cycle's chip (OKRGoal UX review, T6). It read "1 of 7 done" while
 * phase 1 was open and phase 4 was ticked: true, because Guided mode lets a
 * phase pass out of order (METHOD.md §2.3), and read as wrong. The chip now
 * names what is done and what is open.
 */

const t = (key: string, values?: Readonly<Record<string, string | number>>) =>
  translate(CATALOGUES.en, key, values);

const phase = (number: number, state: "pass" | "todo" | "not_applicable") => ({
  phase: number,
  state,
});

describe("the cycle's phase chip", () => {
  it("names a phase done out of order and the first one open", () => {
    expect(
      phaseProgress(t, [
        phase(0, "not_applicable"),
        phase(1, "todo"),
        phase(2, "todo"),
        phase(3, "todo"),
        phase(4, "pass"),
        phase(5, "todo"),
      ]),
    ).toEqual({ text: "Phase 4 done, phase 1 open", complete: false });
  });

  it("lists several done phases", () => {
    expect(
      phaseProgress(t, [phase(1, "pass"), phase(2, "pass"), phase(3, "todo")])
        .text,
    ).toBe("Phases 1, 2 done, phase 3 open");
  });

  it("says only what is open when nothing is done", () => {
    expect(phaseProgress(t, [phase(1, "todo"), phase(2, "todo")]).text).toBe(
      "Phase 1 open",
    );
  });

  it("says every applicable phase is done", () => {
    expect(
      phaseProgress(t, [
        phase(0, "not_applicable"),
        phase(1, "pass"),
        phase(2, "pass"),
      ]),
    ).toEqual({ text: "All 2 phases done", complete: true });
  });
});
