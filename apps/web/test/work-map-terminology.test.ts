import { resolveTerminology } from "@openokr/method";
import { describe, expect, it } from "vitest";
import { rowKindAbbreviation } from "../app/work-map.tsx";

/**
 * The Work Map's row-kind badge reads a workspace's own terminology
 * (TECHNICAL-PLAN §4.14), instead of the canon words regardless of what a
 * workspace renamed.
 *
 * Found by a manual UAT pass, 29 September 2026 (M03-06): the rename saved
 * and survived a reload, and the badge kept saying OBJ regardless, because
 * nothing ever read `rhythm.read`'s own `terminology` field back into a
 * screen. `apps/web/lib/terminology.ts` is the read path; this is the one
 * screen it was wired into.
 */
describe("rowKindAbbreviation", () => {
  it("abbreviates the canon terms exactly as the mockup drew them", () => {
    const canon = resolveTerminology();
    expect(rowKindAbbreviation("goal", canon)).toBe("OBJ");
    expect(rowKindAbbreviation("key_result", canon)).toBe("KR");
  });

  it("abbreviates a renamed single-word term from its own word", () => {
    const renamed = resolveTerminology({
      objective: { singular: "Goal", plural: "Goals" },
    });
    expect(rowKindAbbreviation("goal", renamed)).toBe("GOA");
  });

  it("abbreviates a renamed multi-word term one letter per word", () => {
    const renamed = resolveTerminology({
      keyResult: { singular: "Success metric", plural: "Success metrics" },
    });
    expect(rowKindAbbreviation("key_result", renamed)).toBe("SM");
  });
});
