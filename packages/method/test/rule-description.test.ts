import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_CHECKS,
  CYCLE_CHECKS,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
} from "../src/quality.ts";
import { describeRule } from "../src/rule-description.ts";
import { METHOD_SECTIONS } from "../src/sections.ts";
import { TRIGGER_CATALOGUE } from "../src/triggers.ts";

/**
 * A rule described for a preview, from the catalogues alone.
 *
 * Every verdict and every nudge names a rule by its key, "KR-3" or
 * "checkin.overdue", and a reader cannot know what either means without
 * opening the rule. The preview says it in place, in the words the
 * catalogues already hold, so no screen writes its own account of a rule.
 */

const CHECKS = [
  ...OBJECTIVE_CHECKS,
  ...KEY_RESULT_CHECKS,
  ...ALIGNMENT_CHECKS,
  ...CYCLE_CHECKS,
];

describe("a quality check", () => {
  it("is named by its id and title, with the cases it looks for and its section", () => {
    expect(describeRule("KR-3")).toEqual({
      key: "KR-3",
      kind: "key_result",
      name: "KR-3 Complete",
      looksFor: ["Target, date or owner missing", "Baseline missing"],
      fires: null,
      recipient: null,
      section: "4.2",
    });
  });

  it("is found whatever case the key is written in, as the rule page finds it", () => {
    expect(describeRule("obj-1")?.name).toBe("OBJ-1 Outcome, not output");
  });

  it("is described for every check, in a section the document has", () => {
    for (const check of CHECKS) {
      const described = describeRule(check.id);
      expect(described?.kind).toBe(check.group);
      expect(METHOD_SECTIONS).toHaveProperty([described?.section ?? ""]);
      // A passing case is not something the check looks for.
      expect(described?.looksFor).toEqual(
        check.conditions
          .filter((row) => row.status !== "pass")
          .map((row) => row.condition),
      );
    }
  });
});

describe("a nudge rule", () => {
  it("is named by its title, with when it fires and who hears it", () => {
    const overdue = TRIGGER_CATALOGUE.find(
      (trigger) => trigger.key === "checkin.overdue",
    );
    expect(describeRule("checkin.overdue")).toEqual({
      key: "checkin.overdue",
      kind: "trigger",
      name: overdue?.title,
      looksFor: [],
      fires: overdue?.fires,
      recipient: overdue?.recipient,
      // The trigger catalogue is AI-NATIVE-PLAN's, not METHOD.md's, so there
      // is no METHOD.md section to link to.
      section: null,
    });
  });

  it("is described for every trigger in the catalogue", () => {
    for (const trigger of TRIGGER_CATALOGUE) {
      expect(describeRule(trigger.key)?.name).toBe(trigger.title);
    }
  });
});

it("says nothing for a key that is neither, rather than inventing a rule", () => {
  expect(describeRule("not-a-rule")).toBeNull();
});
