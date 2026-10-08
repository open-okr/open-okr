import { describe, expect, it } from "vitest";
import {
  applyEnforcement,
  CHECK_DEFAULT_LEVELS,
  enforcementLevel,
} from "../src/enforcement.ts";
import {
  defaultPractice,
  PRACTICE_CHECK_IDS,
  resolvePractice,
} from "../src/practice.ts";
import type { QualityVerdict } from "../src/quality.ts";

/**
 * Check enforcement levels (P9-T03a, METHOD.md §4 and §12).
 *
 * A check reports what it sees, and its level decides what that means here.
 * These pin the table in `enforcement.ts` and §4's default level for each
 * check, so a default that drifts from §4 is a failing test with the check's
 * name on it.
 */

const verdict = (
  id: string,
  status: QualityVerdict["status"],
): QualityVerdict => ({
  id,
  status,
  prompt: `${id} prompt`,
  condition: `${id} condition`,
  feedsStrengthScore: true,
});

describe("§4's default level for every check", () => {
  it("names a level for each of the twenty-six checks", () => {
    expect(Object.keys(CHECK_DEFAULT_LEVELS)).toEqual([...PRACTICE_CHECK_IDS]);
  });

  it("matches §4's table on the recommended practice", () => {
    const practice = defaultPractice();
    const levelOf = (id: string) => enforcementLevel(id, practice);
    expect(["OBJ-1", "OBJ-2", "OBJ-5"].map(levelOf)).toEqual([
      "warn",
      "warn",
      "warn",
    ]);
    expect(["OBJ-3", "OBJ-4", "AL-2"].map(levelOf)).toEqual([
      "block",
      "block",
      "block",
    ]);
    expect(["KR-1", "KR-3", "KR-7"].map(levelOf)).toEqual([
      "structural",
      "structural",
      "structural",
    ]);
    expect(["KR-4", "KR-6"].map(levelOf)).toEqual(["info", "info"]);
    expect(["AL-3", "AL-6"].map(levelOf)).toEqual(["off", "off"]);
    expect(levelOf("CY-1")).toBe("info");
  });

  it("makes the cycle checks block under binding phases", () => {
    const binding = resolvePractice("recommended", {
      "phases.enforcement": "binding",
    });
    expect(enforcementLevel("CY-3", binding)).toBe("block");
  });
});

describe("applying a level", () => {
  const practice = defaultPractice();

  it("turns a fail into a warn on a check at warn, keeping the prompt", () => {
    const [obj1] = applyEnforcement([verdict("OBJ-1", "fail")], practice);
    expect(obj1).toMatchObject({ status: "warn", prompt: "OBJ-1 prompt" });
  });

  it("keeps a structural check's fails and its warns as they came", () => {
    expect(
      applyEnforcement(
        [verdict("KR-1", "fail"), verdict("KR-3", "warn")],
        practice,
      ).map((entry) => entry.status),
    ).toEqual(["fail", "warn"]);
  });

  it("turns a warn into a note on a check at info", () => {
    const [kr4] = applyEnforcement([verdict("KR-4", "warn")], practice);
    expect(kr4?.status).toBe("info");
  });

  it("drops a check that is off, and leaves passes and todos alone", () => {
    expect(
      applyEnforcement(
        [
          verdict("AL-3", "fail"),
          verdict("OBJ-2", "pass"),
          verdict("KR-6", "todo"),
        ],
        practice,
      ).map((entry) => entry.id),
    ).toEqual(["OBJ-2", "KR-6"]);
  });

  it("raises a warn to a fail where the workspace sets the check to block", () => {
    const blocking = resolvePractice("recommended", {
      "checks.OBJ-1": "block",
    });
    const [obj1] = applyEnforcement([verdict("OBJ-1", "warn")], blocking);
    expect(obj1?.status).toBe("fail");
  });
});

describe("strict mode", () => {
  it("raises every check to block, from the setting or from the threshold", () => {
    const strict = resolvePractice("recommended", { strictMode: "on" });
    const fromSetting = applyEnforcement(
      [verdict("OBJ-1", "warn"), verdict("KR-4", "warn")],
      strict,
    );
    const fromThreshold = applyEnforcement(
      [verdict("OBJ-1", "warn"), verdict("KR-4", "warn")],
      defaultPractice(),
      { strict: true },
    );
    expect(fromSetting.map((entry) => entry.status)).toEqual(["fail", "fail"]);
    expect(fromThreshold).toEqual(fromSetting);
  });

  it("leaves a check the workspace turned off, off", () => {
    const strict = resolvePractice("recommended", {
      strictMode: "on",
      "checks.OBJ-2": "off",
    });
    expect(applyEnforcement([verdict("OBJ-2", "warn")], strict)).toEqual([]);
  });
});
