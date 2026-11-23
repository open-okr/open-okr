import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The scorecard export's header row is for people reading a spreadsheet, so
 * it comes from the catalogue in the requester's locale (languages.md §13).
 * Values stay machine values. Read raw, because `readScreen` would resolve
 * each `t("key")` back to English and hide a hard-coded header.
 */
const page = readFileSync(
  fileURLToPath(new URL("../app/scorecard/page.tsx", import.meta.url)),
  "utf8",
);

describe("the scorecard CSV export", () => {
  test("has no machine-name header row", () => {
    expect(page).not.toContain("cycle,starts_on,result");
  });

  test("builds its headers from the catalogue", () => {
    for (const key of [
      "scorecard.cycle",
      "scorecard.startsOn",
      "scorecard.result",
      "scorecard.verdict",
      "scorecard.fullyAchieved",
      "scorecard.strong",
      "scorecard.partial",
      "scorecard.little",
    ]) {
      expect(page, key).toContain(`"${key}"`);
    }
  });
});
