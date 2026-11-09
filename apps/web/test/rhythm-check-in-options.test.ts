import { describe, expect, test } from "vitest";
import { checkInFrequencyOptions } from "../app/admin/rhythm/check-in-options";

/**
 * The workspace's check-in frequency picker (plan 0.7.0, M4).
 *
 * METHOD.md §7.1 and §11 name daily, weekly, every two weeks and monthly. The
 * picker also offered quarterly, which no goal checks in at, and the space
 * screen already hid it for that reason.
 */
describe("the check-in frequency picker on Admin, Rhythm", () => {
  test("offers the four frequencies METHOD.md names", () => {
    expect(checkInFrequencyOptions("weekly")).toEqual([
      "daily",
      "weekly",
      "biweekly",
      "monthly",
    ]);
  });

  test("keeps quarterly only for a workspace that already chose it, so opening the form changes nothing", () => {
    expect(checkInFrequencyOptions("quarterly")).toEqual([
      "daily",
      "weekly",
      "biweekly",
      "monthly",
      "quarterly",
    ]);
  });
});
