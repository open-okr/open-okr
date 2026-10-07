import { describe, expect, it } from "vitest";
import {
  defaultPractice,
  differencesFromProfile,
  isPracticeKey,
  levelsInUse,
  PRACTICE,
  PRACTICE_CHECK_IDS,
  PRACTICE_KEYS,
  PROFILE_KEYS,
  PROFILES,
  practiceInGroup,
  resolvePractice,
  switchProfile,
  validatePracticeOverrides,
} from "../src/practice.ts";
import {
  ALIGNMENT_CHECKS,
  CYCLE_CHECKS,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
} from "../src/quality.ts";
import { canonThresholds, validateOverrides } from "../src/thresholds.ts";

/**
 * The METHOD.md §12 practice settings (P9-T01).
 *
 * The same guarantees the §11 threshold registry gives, for the choices rather
 * than the numbers: every setting is complete and self-describing, a stored
 * value is validated rather than trusted, an unknown key is reported rather
 * than ignored, and a resolved read never depends on a value the registry
 * would now refuse. `pnpm method:check` compares the labels with §12.1 itself.
 */

describe("the registry is complete and self-describing", () => {
  it("gives every setting a label, a section, a source and a default among its options", () => {
    for (const key of PRACTICE_KEYS) {
      const entry = PRACTICE[key];
      expect(entry.label, `${key} label`).toBeTruthy();
      expect(entry.section, `${key} section`).toMatch(/^§/);
      expect(entry.source, `${key} source`).toBeTruthy();
      expect(entry.options.length, `${key} options`).toBeGreaterThan(1);
      expect(
        (entry.options as readonly string[]).includes(entry.default),
        `${key} default "${entry.default}" is one of its options`,
      ).toBe(true);
    }
  });

  it("has one enforcement setting for each of the twenty-six checks", () => {
    const checks = [
      ...OBJECTIVE_CHECKS,
      ...KEY_RESULT_CHECKS,
      ...ALIGNMENT_CHECKS,
      ...CYCLE_CHECKS,
    ].map((check) => `checks.${check.id}`);
    expect(checks).toHaveLength(26);
    expect(PRACTICE_CHECK_IDS.map((id) => `checks.${id}`)).toEqual(checks);
    expect(practiceInGroup("checks")).toEqual([...checks, "strictMode"]);
    for (const key of checks) {
      expect(isPracticeKey(key), key).toBe(true);
    }
  });

  it("blocks on the two structural gates, warns on three and leaves the sixth off", () => {
    const practice = defaultPractice();
    expect(
      [1, 2, 3, 4, 5, 6].map((gate) => practice[`gates.${gate}` as "gates.1"]),
    ).toEqual(["block", "block", "warn", "warn", "warn", "off"]);
  });

  it("writes at any time, keeps phases guided and leaves the reviewer optional by default", () => {
    const practice = defaultPractice();
    expect(practice["writing.when"]).toBe("anytime");
    expect(practice["phases.enforcement"]).toBe("guided");
    expect(practice.reviewer).toBe("optional");
    expect(practice["okr.kinds"]).toBe("both");
    expect(practice["levels.individual"]).toBe("off");
    expect(practice["levels.company"]).toBe("on");
  });
});

describe("profiles", () => {
  it("defines the five profiles §12.2 names, Recommended first and empty", () => {
    expect(PROFILE_KEYS).toEqual([
      "recommended",
      "googleStyle",
      "radicalFocus",
      "lightweight",
      "governed",
    ]);
    expect(PROFILES.recommended.practice).toEqual({});
    expect(PROFILES.recommended.thresholds).toEqual({});
  });

  it("sets only valid practice values and valid thresholds", () => {
    for (const key of PROFILE_KEYS) {
      const profile = PROFILES[key];
      expect(validatePracticeOverrides(profile.practice).problems, key).toEqual(
        [],
      );
      expect(validateOverrides(profile.thresholds).problems, key).toEqual([]);
    }
  });

  it("sets nothing a profile would set to the default anyway", () => {
    // "What it sets differently from Recommended": a profile entry equal to
    // the default is a difference that is not one, and it would show on the
    // settings screen as a change nobody made.
    const defaults = defaultPractice() as Record<string, string>;
    for (const key of PROFILE_KEYS) {
      for (const [setting, value] of Object.entries(PROFILES[key].practice)) {
        expect(value, `${key} sets ${setting}`).not.toBe(defaults[setting]);
      }
    }
  });

  it("makes the governed profile the strict one §12.2 describes", () => {
    const governed = resolvePractice("governed");
    expect(governed["phases.enforcement"]).toBe("binding");
    expect(governed["writing.when"]).toBe("planningWindow");
    expect(governed["writing.midCycleAs"]).toBe("reviewerApproval");
    expect(governed.reviewer).toBe("required");
    expect([
      governed["gates.3"],
      governed["gates.4"],
      governed["gates.5"],
    ]).toEqual(["block", "block", "block"]);
    expect(governed["checks.AL-3"]).toBe("warn");
    expect(governed["escalation.sponsorInLadders"]).toBe("on");
  });
});

describe("resolution", () => {
  it("returns every default for a fresh workspace", () => {
    expect(resolvePractice("recommended", {})).toEqual(defaultPractice());
    expect(resolvePractice(null, undefined)).toEqual(defaultPractice());
  });

  it("lays the profile over the defaults and the workspace's changes over the profile", () => {
    const resolved = resolvePractice("governed", { reviewer: "optional" });
    expect(resolved["phases.enforcement"]).toBe("binding");
    expect(resolved.reviewer).toBe("optional");
  });

  it("keeps a workspace's changes across a switch of profile, and finds them on the way back", () => {
    const changes = { "review.format": "split" };
    expect(resolvePractice("lightweight", changes)["review.format"]).toBe(
      "split",
    );
    expect(resolvePractice("recommended", changes)["review.format"]).toBe(
      "split",
    );
  });

  it("drops an unknown key or a value the registry would refuse, rather than failing the read", () => {
    const resolved = resolvePractice("recommended", {
      "writing.when": "whenever",
      "not.a.setting": "on",
      reviewer: "off",
    });
    expect(resolved["writing.when"]).toBe("anytime");
    expect(resolved.reviewer).toBe("off");
    expect(Object.hasOwn(resolved, "not.a.setting")).toBe(false);
  });

  it("reads an unknown profile as Recommended", () => {
    expect(resolvePractice("bespoke")).toEqual(defaultPractice());
  });

  it("names only the settings where a workspace differs from its profile", () => {
    expect(
      differencesFromProfile("governed", { reviewer: "required" }),
    ).toEqual([]);
    expect(
      differencesFromProfile("governed", {
        reviewer: "off",
        "review.format": "split",
      }),
    ).toEqual(["reviewer", "review.format"]);
  });
});

describe("validation", () => {
  it("reports every problem at once, with what to choose instead", () => {
    const { overrides, problems } = validatePracticeOverrides({
      "writing.when": "whenever",
      "checks.OBJ-9": "block",
      "checks.OBJ-1": "block",
    });
    expect(overrides).toEqual({ "checks.OBJ-1": "block" });
    expect(problems.map((problem) => problem.key)).toEqual([
      "writing.when",
      "checks.OBJ-9",
    ]);
    expect(problems[0]?.message).toContain(
      "anytime, planningWindow, afterPhases",
    );
    expect(problems[1]?.message).toContain("not a practice setting");
  });

  it("refuses anything that is not an object", () => {
    expect(validatePracticeOverrides(["reviewer"]).problems).toHaveLength(1);
    expect(validatePracticeOverrides(null).problems).toHaveLength(1);
  });
});

describe("option labels", () => {
  it("words every option of every setting, and nothing else", () => {
    // The settings screen shows these words, so an option without one would
    // render as its stored key. `pnpm method:check` holds the words to §12.1.
    for (const key of PRACTICE_KEYS) {
      const entry = PRACTICE[key];
      expect(Object.keys(entry.optionLabels).sort(), key).toEqual(
        [...entry.options].sort(),
      );
      for (const words of Object.values(entry.optionLabels)) {
        expect((words as string).length, key).toBeGreaterThan(0);
      }
    }
  });
});

describe("switching profile (P9-T05)", () => {
  const canon = canonThresholds() as Record<string, unknown>;

  it("reports the practice values that move, and changes nothing else", () => {
    const change = switchProfile(
      { profile: "recommended", overrides: {}, thresholds: canon },
      "lightweight",
    );
    expect(change.from).toBe("recommended");
    expect(change.to).toBe("lightweight");
    expect(
      Object.fromEntries(change.practice.map((c) => [c.key, c.to])),
    ).toEqual(PROFILES.lightweight.practice);
    expect(change.keptPractice).toEqual([]);
  });

  it("applies the thresholds the new profile sets", () => {
    const change = switchProfile(
      { profile: "recommended", overrides: {}, thresholds: canon },
      "lightweight",
    );
    expect(change.thresholds).toEqual([
      {
        key: "cadence.checkInFrequency",
        from: "weekly",
        to: "biweekly",
        toCanon: false,
      },
    ]);
  });

  it("returns the old profile's thresholds to the canon when the new one says nothing", () => {
    const onRadicalFocus = {
      ...canon,
      ...(PROFILES.radicalFocus.thresholds as Record<string, unknown>),
    };
    const change = switchProfile(
      { profile: "radicalFocus", overrides: {}, thresholds: onRadicalFocus },
      "recommended",
    );
    expect(change.thresholds.map((c) => [c.key, c.toCanon])).toEqual([
      ["quality.objectivesPerUnitCap", true],
      ["quality.keyResultsPerObjective", true],
    ]);
    expect(change.thresholds[1]?.to).toEqual(
      canon["quality.keyResultsPerObjective"],
    );
  });

  it("keeps a threshold the workspace set itself, and says so", () => {
    // Lightweight would make check-ins fortnightly; this workspace chose
    // monthly before switching, and that is its own choice to keep.
    const change = switchProfile(
      {
        profile: "recommended",
        overrides: {},
        thresholds: { ...canon, "cadence.checkInFrequency": "monthly" },
      },
      "lightweight",
    );
    expect(change.thresholds).toEqual([]);
    expect(change.keptThresholds).toEqual(["cadence.checkInFrequency"]);
  });

  it("compares a composite threshold by value, whatever order its parts were stored in", () => {
    const stored = { high: 3, low: 2 };
    const change = switchProfile(
      {
        profile: "radicalFocus",
        overrides: {},
        thresholds: {
          ...canon,
          "quality.objectivesPerUnitCap": 1,
          "quality.keyResultsPerObjective": stored,
        },
      },
      "radicalFocus",
    );
    expect(change.thresholds).toEqual([]);
    expect(change.keptThresholds).toEqual([]);
  });

  it("keeps the workspace's own practice changes and names those that differ from the new profile", () => {
    const change = switchProfile(
      {
        profile: "recommended",
        overrides: { reviewer: "required", strictMode: "on" },
        thresholds: canon,
      },
      "googleStyle",
    );
    // Google-style turns reviewers off; this workspace requires them, and
    // still does after the switch.
    expect(change.practice.map((c) => c.key)).not.toContain("reviewer");
    expect(change.keptPractice).toEqual(["reviewer", "strictMode"]);
  });

  it("reads an unknown stored profile as Recommended", () => {
    const change = switchProfile(
      { profile: "retired", overrides: {}, thresholds: canon },
      "recommended",
    );
    expect(change.from).toBe("recommended");
    expect(change.practice).toEqual([]);
    expect(change.thresholds).toEqual([]);
  });
});

describe("levels in use (P9-T07a-c)", () => {
  it("are company, department and team by default, in §2.7's order", () => {
    expect(levelsInUse(defaultPractice())).toEqual([
      "company",
      "department",
      "team",
    ]);
  });

  it("follow the profile and the workspace's own changes", () => {
    // Google-style turns individual on and department off.
    expect(levelsInUse(resolvePractice("googleStyle"))).toEqual([
      "company",
      "team",
      "individual",
    ]);
    expect(
      levelsInUse(
        resolvePractice("recommended", { "levels.department": "off" }),
      ),
    ).toEqual(["company", "team"]);
  });
});
