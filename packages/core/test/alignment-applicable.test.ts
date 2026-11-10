import { ALIGNMENT_FINDING_KINDS, ALIGNMENT_FINDING_STATES } from "@openokr/db";
import { describe, expect, it } from "vitest";
import {
  notOneClickBecause,
  oneClickApplicable,
} from "../src/alignment/applicable.ts";

/**
 * Whether a finding can be applied with one click (METHOD.md §5.3, design
 * `alignment-engine.md` §9, plan 0.7.0 A6).
 *
 * Derived from four columns the row already has, never stored. The action,
 * the read and the panel all ask this one function, so a button the action
 * would refuse cannot be drawn. Every kind and every state is walked here,
 * because the rule is "only this one combination" and the way it breaks is
 * a second combination quietly saying yes.
 */

const SUBJECT = "00000000-0000-7000-8000-00000000000a";
const TARGET = "00000000-0000-7000-8000-00000000000b";

const finding = (
  overrides: Partial<{
    kind: string;
    state: string;
    subjectGoalId: string | null;
    targetGoalId: string | null;
  }> = {},
) => ({
  kind: "relink",
  state: "open",
  subjectGoalId: SUBJECT,
  targetGoalId: TARGET,
  ...overrides,
});

describe("one-click applicability", () => {
  it("is true for an open relink naming the goal to move and its new parent", () => {
    expect(oneClickApplicable(finding())).toBe(true);
    expect(notOneClickBecause(finding())).toBeNull();
  });

  it("is false for every other kind, open and naming both goals", () => {
    const others = ALIGNMENT_FINDING_KINDS.filter((kind) => kind !== "relink");
    // Five: the engine's structure, the Coach's dependency, conflict and gap,
    // and the divergence sweep. A dependency needs a provider and a direction,
    // which is a decision rather than a click (design §9.2, D3).
    expect(others).toEqual([
      "structure",
      "dependency",
      "conflict",
      "gap",
      "divergence",
    ]);
    for (const kind of others) {
      expect(oneClickApplicable(finding({ kind })), kind).toBe(false);
      expect(notOneClickBecause(finding({ kind })), kind).toBe(
        "not_mechanical",
      );
    }
  });

  it("is false once a relink has been decided, either way", () => {
    const decided = ALIGNMENT_FINDING_STATES.filter(
      (state) => state !== "open",
    );
    expect(decided).toEqual(["applied", "dismissed"]);
    for (const state of decided) {
      expect(oneClickApplicable(finding({ state })), state).toBe(false);
      expect(notOneClickBecause(finding({ state })), state).toBe("decided");
    }
  });

  it("is false for a relink missing either goal", () => {
    for (const missing of [
      { targetGoalId: null },
      { subjectGoalId: null },
      { subjectGoalId: null, targetGoalId: null },
    ]) {
      expect(oneClickApplicable(finding(missing))).toBe(false);
      expect(notOneClickBecause(finding(missing))).toBe("missing_goal");
    }
  });

  it("names the first reason when there are several", () => {
    // The kind first, because a conflict is never applicable whatever its
    // state, and telling somebody "already decided" about one would suggest
    // an open one could be.
    expect(
      notOneClickBecause(
        finding({ kind: "conflict", state: "dismissed", targetGoalId: null }),
      ),
    ).toBe("not_mechanical");
    expect(
      notOneClickBecause(finding({ state: "applied", targetGoalId: null })),
    ).toBe("decided");
  });
});
