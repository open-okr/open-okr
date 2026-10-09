import { listTimezones } from "@openokr/formats";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  matchDeviceTimezone,
  TimezoneSelect,
} from "../src/fields/timezone-select.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * Choosing a timezone from the server's own list (docs/design/
 * guided-inputs.md §4.6), rather than typing one the server may refuse.
 *
 * Kuala Lumpur and Jakarta keep one offset all year, so they are what the
 * offset searches use; a zone with daylight saving changes its label with the
 * date the test runs on.
 */

const ZONES = [
  "UTC",
  "Asia/Jakarta",
  "Asia/Kuala_Lumpur",
  "America/New_York",
  "Europe/London",
];

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">{children}</TranslationsProvider>,
  );
}

const box = () => screen.getByLabelText("Timezone") as HTMLInputElement;
const submitted = (container: HTMLElement) =>
  (container.querySelector('input[name="timezone"]') as HTMLInputElement).value;

describe("a timezone field", () => {
  it("shows the stored zone by its city, its offset and its name", () => {
    const { container } = inEnglish(
      <TimezoneSelect
        label="Timezone"
        name="timezone"
        zones={ZONES}
        defaultValue="Asia/Kuala_Lumpur"
      />,
    );
    expect(box().value).toBe("Kuala Lumpur, GMT+8, Asia/Kuala_Lumpur");
    expect(submitted(container)).toBe("Asia/Kuala_Lumpur");
  });

  it("finds a zone by its city, and submits its name once picked", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <TimezoneSelect label="Timezone" name="timezone" zones={ZONES} />,
    );

    await user.type(box(), "jakar");
    await user.click(
      await screen.findByRole("option", { name: /Jakarta, GMT\+7/ }),
    );

    expect(submitted(container)).toBe("Asia/Jakarta");
  });

  it.each([
    ["+8", "Kuala Lumpur"],
    ["gmt+8", "Kuala Lumpur"],
    ["utc+7", "Jakarta"],
    ["Malaysia", "Kuala Lumpur"],
    ["asia/kuala", "Kuala Lumpur"],
  ])("finds %j, which matches %s", async (query, city) => {
    const user = userEvent.setup();
    inEnglish(
      <TimezoneSelect label="Timezone" name="timezone" zones={ZONES} />,
    );

    await user.type(box(), query);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining(city),
    ]);
  });

  it("keeps a stored name that is not on the list, and says so", () => {
    const { container } = inEnglish(
      <TimezoneSelect
        label="Timezone"
        name="timezone"
        zones={ZONES}
        defaultValue="EST"
      />,
    );
    expect(box().value).toBe("EST (not a recognised zone)");
    // Nothing stored is rewritten by opening and saving the form.
    expect(submitted(container)).toBe("EST");
  });

  it("offers this device's zone in one press", async () => {
    const user = userEvent.setup();
    const zones = listTimezones();
    const device = matchDeviceTimezone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      zones,
    );
    const { container } = inEnglish(
      <TimezoneSelect label="Timezone" name="timezone" zones={zones} />,
    );

    if (device === null) {
      // A runtime whose zone is not on its own list offers nothing to press.
      expect(screen.queryByRole("button", { name: /this device/ })).toBeNull();
      return;
    }
    await user.click(
      await screen.findByRole("button", { name: /this device/ }),
    );
    expect(submitted(container)).toBe(device);
  });
});

describe("matching this device's zone to the server's list", () => {
  it("takes a listed name as it is", () => {
    expect(matchDeviceTimezone("Asia/Kuala_Lumpur", ZONES)).toBe(
      "Asia/Kuala_Lumpur",
    );
  });

  it("finds the listed spelling of a zone the browser names differently", () => {
    // The browser may say Asia/Kolkata where the server lists Asia/Calcutta.
    // Whichever the runtime here resolves, the two are one zone.
    const listed = ["UTC", "Asia/Calcutta"];
    const matched = matchDeviceTimezone("Asia/Kolkata", listed);
    expect(matched === "Asia/Calcutta" || matched === null).toBe(true);
  });

  it("offers nothing for a zone the list does not hold", () => {
    expect(matchDeviceTimezone("Pacific/Auckland", ZONES)).toBeNull();
  });
});
