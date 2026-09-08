import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRIGGER_CATALOGUE } from "@openokr/method";
import { describe, expect, test } from "vitest";

/**
 * A workspace can turn a rule down (S-36, P6-G21, GAP-AUDIT G-04).
 *
 * **Every switch existed and none had a handle.** `nudge_rules` has held
 * `enabled`, `channel_override`, `escalation_ladder` and `quiet_mode_exempt`
 * since P4-T04b, and `rhythm_settings.quiet_mode` since the same task. The
 * suppression decision has read the first, the fourth and the workspace flag
 * all along, so a workspace being drowned by its own product could see the
 * volume on this very page and could not change anything.
 *
 * The reads, the writes and the suppression are proved against a real database
 * in `packages/core`. What is checked here is that the card enumerates the
 * catalogue rather than a list of its own, and that it stays on the right side
 * of the client boundary.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const cards = at("../app/admin/nudges/rule-cards.tsx");
const actions = at("../app/admin/nudges/rule-actions.ts");
const page = at("../app/admin/nudges/page.tsx");

describe("the nudge rule cards", () => {
  test("enumerate the catalogue rather than a list of their own", () => {
    // Forty-eight rules today. A card that named any of them would be a second
    // copy of §6.4, and a trigger added to the method package would not appear.
    expect(TRIGGER_CATALOGUE.length).toBeGreaterThan(10);
    expect(page).toContain('"nudges.rules"');
    expect(cards).toContain("rules.map((rule)");
    for (const trigger of TRIGGER_CATALOGUE.slice(0, 5)) {
      expect(cards, `${trigger.key} is named in the component`).not.toContain(
        trigger.key,
      );
    }
  });

  test("call the two writes that had no caller", () => {
    expect(actions).toContain('"nudges.setRule"');
    // Workspace quiet mode goes through rhythm.update, which took every other
    // rhythm field and not this one.
    expect(actions).toContain('"rhythm.update"');
    expect(actions).toContain("quietMode");
  });

  test("stay on the server side of the value boundary", () => {
    // A client component that imports a value from `@openokr/core` or
    // `@openokr/db` pulls the database layer into its bundle and the build
    // fails on `dns`, which is what happened at P6-G13b.
    expect(cards).toContain('"use client"');
    expect(cards).not.toContain('from "@openokr/core"');
    expect(cards).not.toContain('from "@openokr/db"');
    expect(cards).not.toContain('from "@openokr/method"');
    expect(page).toContain("const NUDGE_CHANNELS");
  });

  test("show the volume beside the switch, because that is the argument", () => {
    expect(cards).toContain("sent, ");
    expect(cards).toContain("held");
  });

  test("say what a disabled rule does, which is not vanish", () => {
    // The run still writes a row with `disabled` as its reason, which is what
    // keeps the volume page honest about what the product decided.
    expect(cards).toContain("The run still records each one with its reason");
  });

  test("say why quiet mode does not silence an escalation", () => {
    expect(cards).toContain("§6.3 puts an");
    expect(cards).toContain("Speaks through quiet mode");
  });
});
