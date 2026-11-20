import { describe, expect, it } from "vitest";
import {
  checkDirectionCode,
  type DirectionDebtEntry,
} from "../../../scripts/check-direction.ts";

/**
 * AC-17: Direction check (docs/design/languages.md §9, §18 row S10).
 *
 * Verifies that the physical direction check catches physical CSS classes
 * (like ml-2), respects the debt list, and allows direction-neutral comments.
 */
describe("check-direction (AC-17)", () => {
  it("fails on a new ml-2 naming file and line", () => {
    const file = "apps/web/app/example.tsx";
    const source = `
      export function Example() {
        return <div className="flex ml-2 text-ink">Hello</div>;
      }
    `;

    const violations = checkDirectionCode(file, source, []);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: "apps/web/app/example.tsx",
      line: 3,
      pattern: "ml-2",
    });
  });

  it("passes when the entry is in the debt list", () => {
    const file = "apps/web/app/example.tsx";
    const source = `
      export function Example() {
        return <div className="flex ml-2 text-ink">Hello</div>;
      }
    `;

    const debt: DirectionDebtEntry[] = [
      { file: "apps/web/app/example.tsx", line: 3, pattern: "ml-2" },
    ];

    const violations = checkDirectionCode(file, source, debt);
    expect(violations).toEqual([]);
  });

  it("passes when marked with a direction-neutral: comment", () => {
    const file = "apps/web/app/example.tsx";
    const source = `
      export function Example() {
        // direction-neutral: physical margin needed for hardware badge
        return <div className="flex ml-2 text-ink">Hello</div>;
      }
    `;

    const violations = checkDirectionCode(file, source, []);
    expect(violations).toEqual([]);
  });
});
