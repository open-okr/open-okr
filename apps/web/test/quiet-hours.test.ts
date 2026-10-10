import { describe, expect, it } from "vitest";
import { quietHoursFromForm } from "../lib/quiet-hours.ts";

/**
 * How a form's quiet-hours pair is read, on the profile and on the channel
 * settings alike.
 *
 * The profile form posted two empty boxes it had never filled with the saved
 * window, and two empty boxes mean "off", so saving a new timezone deleted a
 * member's quiet hours. These pin what each shape of the pair means.
 */

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

describe("the quiet-hours pair a form submitted", () => {
  it("is a window when both times are given", () => {
    expect(
      quietHoursFromForm(form({ quietStart: "22:00", quietEnd: "07:00" })),
    ).toEqual({ ok: true, value: { start: "22:00", end: "07:00" } });
  });

  it("turns quiet hours off when both are cleared", () => {
    expect(quietHoursFromForm(form({ quietStart: "", quietEnd: " " }))).toEqual(
      { ok: true, value: null },
    );
  });

  it("is refused when only one time is given, rather than read as off", () => {
    expect(
      quietHoursFromForm(form({ quietStart: "22:00", quietEnd: "" })),
    ).toEqual({ ok: false });
    expect(
      quietHoursFromForm(form({ quietStart: "", quietEnd: "07:00" })),
    ).toEqual({ ok: false });
  });

  it("leaves the window alone when the form does not carry the pair", () => {
    const result = quietHoursFromForm(form({ timezone: "Asia/Kuala_Lumpur" }));
    expect(result).toEqual({ ok: true });
    expect(result.ok && result.value).toBeUndefined();
  });
});
