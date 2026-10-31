import { describe, expect, it } from "vitest";
import { dueDayLabel } from "../src/fields/date-format.ts";

/**
 * A due date as a person reads it (OKRGoal UX review, N7): "2026-10-19"
 * beside "13 Oct, 01:53" on the same screen, and neither said "Monday".
 * The server already knows how many days away the date is, so the label
 * takes that rather than a clock of its own.
 */
describe("a due date's label", () => {
  it("says today, tomorrow and yesterday in words", () => {
    expect(dueDayLabel("2026-10-30", 0, "en")).toBe("today");
    expect(dueDayLabel("2026-10-31", 1, "en")).toBe("tomorrow");
    expect(dueDayLabel("2026-10-29", -1, "en")).toBe("yesterday");
  });

  it("names the weekday within the coming week", () => {
    // 2 November 2026 is a Monday.
    expect(dueDayLabel("2026-11-02", 3, "en")).toBe("Mon");
  });

  it("gives day and month further out, and the year only when it differs", () => {
    expect(dueDayLabel("2026-11-09", 10, "en")).toBe("9 Nov");
    expect(dueDayLabel("2027-01-04", 66, "en")).toBe("4 Jan 2027");
    expect(dueDayLabel("2026-10-12", -18, "en")).toBe("12 Oct");
  });

  it("follows the locale", () => {
    expect(dueDayLabel("2026-11-09", 10, "ms")).toBe("9 Nov");
    expect(dueDayLabel("2026-11-02", 3, "ms")).toBe("Isn");
  });

  it("hands back anything that is not a date unchanged", () => {
    expect(dueDayLabel("someday", 3, "en")).toBe("someday");
  });
});
