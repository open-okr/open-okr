import { CATALOGUES } from "@openokr/ui";
import { describe, expect, it } from "vitest";
import {
  REASON_FALLBACK_KEYS,
  REASON_LABEL_KEYS,
} from "../app/inbox/subject-link.ts";

/**
 * A row with no activity behind it says what it is from its reason (UAT
 * BUG-013): a check-in waiting for review read "Something happened here."
 */
describe("the inbox's sentence for a row with no activity", () => {
  it("covers review, mention and following, in every catalogue", () => {
    for (const reason of ["review", "mentioned", "joined", "role"]) {
      const key = REASON_FALLBACK_KEYS[reason];
      expect(key, reason).toBeDefined();
      for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
        expect(
          (catalogue as Record<string, string>)[key as string],
          `${reason} in ${locale}`,
        ).toBeTruthy();
      }
    }
  });

  it("names only reasons the inbox knows", () => {
    for (const reason of Object.keys(REASON_FALLBACK_KEYS)) {
      expect(Object.keys(REASON_LABEL_KEYS)).toContain(reason);
    }
  });
});
