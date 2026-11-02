import { describe, expect, it } from "vitest";
import {
  PRACTICE,
  PRACTICE_KEYS,
  PROFILE_KEYS,
  PROFILES,
  resolvePractice,
  switchProfile,
} from "../src/practice.ts";
import {
  compareProfiles,
  practiceSettingName,
} from "../src/profile-comparison.ts";
import { canonThresholds, THRESHOLDS } from "../src/thresholds.ts";

/**
 * The five profiles side by side (METHOD.md §12.3).
 *
 * The practice screen's comparison and `pnpm method:check` both read
 * `compareProfiles`, so what is worth proving here is that it describes what
 * choosing a profile actually does: the rows are exactly what some profile
 * moves, and each cell is the value that profile gives a fresh workspace.
 */

const rows = compareProfiles();
const row = (key: string) => {
  const found = rows.find((entry) => entry.key === key);
  if (!found) {
    throw new Error(`no row for ${key}`);
  }
  return found;
};

describe("the rows", () => {
  it("are every setting and threshold some profile sets differently from Recommended, and nothing else", () => {
    const recommended = resolvePractice("recommended");
    const canon = canonThresholds() as Record<string, unknown>;
    const expected = new Set<string>();
    for (const profile of PROFILE_KEYS) {
      const practice = resolvePractice(profile);
      for (const key of PRACTICE_KEYS) {
        if (practice[key] !== recommended[key]) {
          expected.add(key);
        }
      }
      for (const [key, value] of Object.entries(PROFILES[profile].thresholds)) {
        if (JSON.stringify(value) !== JSON.stringify(canon[key])) {
          expected.add(key);
        }
      }
    }
    expect(new Set(rows.map((entry) => entry.key))).toEqual(expected);
    // Fifteen today. A floor, so a comparison that quietly found nothing fails.
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it("put the practice settings first, in the registry's order, then the thresholds in theirs", () => {
    const practice = rows.filter((entry) => entry.kind === "practice");
    const thresholds = rows.filter((entry) => entry.kind === "threshold");
    expect(rows).toEqual([...practice, ...thresholds]);
    const registryOrder = PRACTICE_KEYS.filter((key) =>
      practice.some((entry) => entry.key === key),
    );
    expect(practice.map((entry) => entry.key)).toEqual(registryOrder);
    const thresholdOrder = Object.keys(THRESHOLDS).filter((key) =>
      thresholds.some((entry) => entry.key === key),
    );
    expect(thresholds.map((entry) => entry.key)).toEqual(thresholdOrder);
  });

  it("have a distinct name each, so a row in METHOD.md can only mean one", () => {
    const names = rows.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the cells", () => {
  it("give every profile a value, and mark only those that differ from Recommended", () => {
    for (const entry of rows) {
      expect(Object.keys(entry.values)).toEqual([...PROFILE_KEYS]);
      expect(entry.differs).not.toContain("recommended");
      expect(entry.differs.length).toBeGreaterThan(0);
      for (const profile of PROFILE_KEYS) {
        expect(entry.differs.includes(profile)).toBe(
          entry.values[profile] !== entry.values.recommended,
        );
      }
    }
  });

  it("read as the settings screen words each option", () => {
    expect(row("phases.enforcement").values).toEqual({
      recommended: "Guided",
      googleStyle: "Guided",
      radicalFocus: "Hidden",
      lightweight: "Hidden",
      governed: "Binding",
    });
    expect(row("writing.midCycleAs").values.governed).toBe(
      PRACTICE["writing.midCycleAs"].optionLabels.reviewerApproval,
    );
    expect(row("levels.department").values.googleStyle).toBe("Off");
  });

  it("word a threshold as a person reads it, not as it is stored", () => {
    expect(row("cadence.checkInFrequency").values.lightweight).toBe(
      "Every two weeks",
    );
    expect(row("cadence.checkInFrequency").values.recommended).toBe("Weekly");
    expect(row("quality.keyResultsPerObjective").values.recommended).toBe(
      "2 to 5",
    );
    expect(row("quality.keyResultsPerObjective").values.radicalFocus).toBe(
      "2 to 3",
    );
    expect(row("quality.objectivesPerUnitCap").values.radicalFocus).toBe("1");
  });

  it("say what choosing each profile does to a fresh workspace", () => {
    // The table is a claim about behaviour, so it is held to the function the
    // write runs: a profile's differing cells are exactly what a switch to it
    // from Recommended moves.
    for (const profile of PROFILE_KEYS) {
      const moved = switchProfile(
        {
          profile: "recommended",
          thresholds: canonThresholds() as Record<string, unknown>,
        },
        profile,
      );
      const changed = [
        ...moved.practice.map((change) => change.key),
        ...moved.thresholds.map((change) => change.key),
      ].sort();
      const differing = rows
        .filter((entry) => entry.differs.includes(profile))
        .map((entry) => entry.key)
        .sort();
      expect(differing).toEqual(changed);
    }
  });
});

describe("setting names", () => {
  it("name every practice setting distinctly, with its item where it has one", () => {
    const names = PRACTICE_KEYS.map(practiceSettingName);
    expect(new Set(names).size).toBe(names.length);
    expect(practiceSettingName("checks.AL-3")).toBe("AL-3 No level skip");
    expect(practiceSettingName("gates.3")).toMatch(/^Gate 3: Alignment/);
    expect(practiceSettingName("levels.individual")).toBe(
      "Levels in use: individual",
    );
    expect(practiceSettingName("reviewer")).toBe("Reviewer per goal");
  });
});
