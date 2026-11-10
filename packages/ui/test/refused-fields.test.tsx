import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ColourInput } from "../src/fields/colour-input.tsx";
import { ConfidenceInput } from "../src/fields/confidence-input.tsx";
import { TextInput } from "../src/fields/text-input.tsx";
import { TimeInput } from "../src/fields/time-input.tsx";
import { TimezoneSelect } from "../src/fields/timezone-select.tsx";
import { TokenInput } from "../src/fields/token-input.tsx";
import { RefusedFields } from "../src/forms/refused-fields.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";
import { RichTextField } from "../src/rich-text/rich-text-field.tsx";

/**
 * A refused save's messages, handed to fields by name (guided-inputs §4.2,
 * plan 0.7.0 U1b): the form whose fields a server page draws.
 */
function form(fields: Readonly<Record<string, string>> | undefined) {
  return render(
    <TranslationsProvider locale="en">
      <form>
        <RefusedFields fields={fields}>
          <TextInput label="Name" name="name" />
          <input type="hidden" name="id" value="space-1" />
        </RefusedFields>
      </form>
    </TranslationsProvider>,
  );
}

describe("RefusedFields", () => {
  test("puts a field's message under that field, marked invalid", () => {
    form({ name: "Up to 80 characters. Shorten it to save." });
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((one) => one.textContent)).toEqual([
      "Up to 80 characters. Shorten it to save.",
    ]);
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  test("says a message no field on the form claims under the form, so none is lost", () => {
    form({ id: "No such space, or you do not have access to it." });
    expect(screen.getByRole("alert").textContent).toBe(
      "No such space, or you do not have access to it.",
    );
    expect(
      screen.getByLabelText("Name").getAttribute("aria-invalid"),
    ).toBeNull();
  });

  test("says nothing when nothing was refused", () => {
    form(undefined);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // A check-in and a vote ask for a confidence, whose number box is unnamed
  // and whose hidden input carries the name (plan U1b).
  test("puts a confidence's message under the confidence", () => {
    render(
      <TranslationsProvider locale="en">
        <form>
          <RefusedFields fields={{ confidence: "Say how confident you are." }}>
            <ConfidenceInput label="Confidence" name="confidence" />
          </RefusedFields>
        </form>
      </TranslationsProvider>,
    );
    expect(screen.getAllByRole("alert").map((one) => one.textContent)).toEqual([
      "Say how confident you are.",
    ]);
    expect(
      // Labelled with its scale, "Confidence (in 10)".
      screen.getByLabelText(/^Confidence/).getAttribute("aria-invalid"),
    ).toBe("true");
  });

  // Admin > General and the profile draw a timezone and a domain list
  // (plan U1b).
  // The branding page's colour (plan U1b).
  test("puts a colour's message under the colour", () => {
    render(
      <TranslationsProvider locale="en">
        <form>
          <RefusedFields fields={{ primaryColor: "Reads as red." }}>
            <ColourInput label="Primary colour" name="primaryColor" />
          </RefusedFields>
        </form>
      </TranslationsProvider>,
    );
    expect(screen.getAllByRole("alert").map((one) => one.textContent)).toEqual([
      "Reads as red.",
    ]);
  });

  test("puts a timezone's and a list's message under each", () => {
    render(
      <TranslationsProvider locale="en">
        <form>
          <RefusedFields
            fields={{
              timezone: "Not a timezone this server knows.",
              trustedEmailDomains: "gmail.com is a free mail provider.",
            }}
          >
            <TimezoneSelect
              label="Timezone"
              name="timezone"
              zones={["Asia/Jakarta", "Europe/London"]}
            />
            <TokenInput
              label="Trusted domains"
              name="trustedEmailDomains"
              rule="domain"
            />
          </RefusedFields>
        </form>
      </TranslationsProvider>,
    );
    expect(screen.getAllByRole("alert").map((one) => one.textContent)).toEqual([
      "Not a timezone this server knows.",
      "gmail.com is a free mail provider.",
    ]);
  });

  // Booking a cycle's weekly sessions asks for a time (plan U1b).
  test("puts a time's message under the time", () => {
    render(
      <TranslationsProvider locale="en">
        <form>
          <RefusedFields fields={{ time: "Not a time of day." }}>
            <TimeInput label="At" name="time" />
          </RefusedFields>
        </form>
      </TranslationsProvider>,
    );
    expect(screen.getAllByRole("alert").map((one) => one.textContent)).toEqual([
      "Not a time of day.",
    ]);
    expect(screen.getByLabelText("At").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  // The cycle's forms write prose through the compact editor, so a refusal
  // of a mission or a capacity note belongs under that field (plan U1b).
  test("puts a rich text field's message under it, linked to the field", () => {
    const { container } = render(
      <TranslationsProvider locale="en">
        <form>
          <RefusedFields fields={{ cuts: "Write what is being cut." }}>
            <RichTextField label="What we cut" name="cuts" />
          </RefusedFields>
        </form>
      </TranslationsProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Write what is being cut.");
    expect(
      container.querySelector("fieldset")?.getAttribute("aria-describedby"),
    ).toBe(alert.id);
  });
});
