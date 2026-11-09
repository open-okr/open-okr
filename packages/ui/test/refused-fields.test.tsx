import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TextInput } from "../src/fields/text-input.tsx";
import { RefusedFields } from "../src/forms/refused-fields.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

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
});
