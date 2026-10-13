import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, test } from "vitest";
import { ConfidenceInput } from "../src/fields/confidence-input.tsx";
import { MetricInput, NumberInput } from "../src/fields/number-input.tsx";
import { TimeRangeInput } from "../src/fields/time-input.tsx";
import { TimezoneSelect } from "../src/fields/timezone-select.tsx";
import { UnitInput } from "../src/fields/unit-input.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * A form reset reaches every field that holds its own value.
 *
 * React resets a form whose action succeeded, so a form that adds one row
 * after another (a key result, a KPI reading, a task) is empty again for the
 * next. A field holding its value in its own state, or in Base UI's, kept the
 * last row's value and posted it with the next row.
 */

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">
      <form>{children}</form>
    </TranslationsProvider>,
  );
}

function resetAndRead(container: HTMLElement, name: string) {
  const form = container.querySelector("form") as HTMLFormElement;
  act(() => form.reset());
  return new FormData(form).get(name);
}

describe("after a form resets", () => {
  test("a number is empty again, or back to its default", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <>
        <NumberInput label="Target" name="target" />
        <MetricInput label="Baseline" name="baseline" defaultValue={10} />
      </>,
    );
    await user.type(screen.getByLabelText("Target"), "42");
    await user.clear(screen.getByLabelText("Baseline"));
    await user.type(screen.getByLabelText("Baseline"), "7");
    await user.tab();
    expect(resetAndRead(container, "target")).toBe("");
    expect(
      new FormData(container.querySelector("form") as HTMLFormElement).get(
        "baseline",
      ),
    ).toBe("10");
  });

  test("a confidence is empty again", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <ConfidenceInput label="Confidence" name="confidence" />,
    );
    await user.type(screen.getByLabelText(/Confidence/), "7");
    await user.tab();
    expect(resetAndRead(container, "confidence")).toBe("");
  });

  test("a unit is back to its default", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <UnitInput label="Unit" name="unit" defaultValue="%" />,
    );
    const field = screen.getByLabelText("Unit");
    await user.clear(field);
    await user.type(field, "widgets");
    await user.tab();
    expect(resetAndRead(container, "unit")).toBe("%");
  });

  test("a timezone is back to its default", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <TimezoneSelect
        label="Timezone"
        name="timezone"
        zones={["UTC", "Asia/Jakarta"]}
        defaultValue="UTC"
      />,
    );
    const box = screen.getByLabelText("Timezone");
    await user.clear(box);
    await user.type(box, "jakar");
    await user.click(
      await screen.findByRole("option", { name: /Jakarta, GMT\+7/ }),
    );
    expect(resetAndRead(container, "timezone")).toBe("UTC");
  });
});

/**
 * A save that succeeds hands the form its new saved value in the same commit
 * that resets it, so the reset has to read the value of that render, not of
 * the one before. Otherwise the quiet hours just saved would be shown as the
 * ones they replaced, and the next save would put the old ones back.
 */
test("a reset after a save goes back to the value just saved", async () => {
  const user = userEvent.setup();
  function Profile() {
    const [saved, setSaved] = useState({ start: "22:00", end: "07:00" });
    return (
      <form
        action={async (form: FormData) => {
          setSaved({
            start: String(form.get("quietStart")),
            end: String(form.get("quietEnd")),
          });
        }}
      >
        <TimeRangeInput
          label="Quiet hours"
          startLabel="Quiet hours start"
          endLabel="Quiet hours end"
          startName="quietStart"
          endName="quietEnd"
          defaultValue={saved}
        />
        <button type="submit">Save</button>
      </form>
    );
  }
  const { container } = render(
    <TranslationsProvider locale="en">
      <Profile />
    </TranslationsProvider>,
  );
  const start = screen.getByLabelText("Quiet hours start");
  await user.clear(start);
  await user.type(start, "21:00");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const form = container.querySelector("form") as HTMLFormElement;
  await waitFor(() =>
    expect(new FormData(form).get("quietStart")).toBe("21:00"),
  );
  // And it stays: nothing later puts the old window back.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(new FormData(form).get("quietStart")).toBe("21:00");
});
