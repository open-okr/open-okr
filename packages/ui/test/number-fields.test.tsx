import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { MetricInput, NumberInput } from "../src/fields/number-input.tsx";
import { UnitInput } from "../src/fields/unit-input.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * Numbers (docs/design/guided-inputs.md §4.8): a number field that formats
 * in the reader's locale, steps with the arrow keys, says its unit, and
 * sends nothing when it is empty, never 0.
 */

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">{children}</TranslationsProvider>,
  );
}

const posted = (container: HTMLElement, name: string) =>
  new FormData(container.querySelector("form") as HTMLFormElement).get(name);

describe("a number field", () => {
  test("is labelled with its unit, and posts the raw number", async () => {
    const { container } = inEnglish(
      <form>
        <NumberInput
          label="Baseline"
          name="baselineValue"
          unit="%"
          defaultValue={1234.5}
        />
      </form>,
    );
    const field = screen.getByLabelText(/Baseline/);
    expect(screen.getByLabelText("Baseline (%)")).toBe(field);
    // Grouped for the reader, raw for the server.
    expect((field as HTMLInputElement).value).toBe("1,234.5");
    expect(posted(container, "baselineValue")).toBe("1234.5");
  });

  test("sends nothing when it is empty, never 0", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <form>
        <NumberInput label="Value" name="value" defaultValue={40} />
      </form>,
    );
    await user.clear(screen.getByLabelText("Value"));
    await user.tab();
    expect(posted(container, "value")).toBe("");
  });

  test("steps with the arrow keys, and holds its bounds", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <form>
        <NumberInput
          label="Weight"
          name="weight"
          defaultValue={99}
          min={0}
          max={100}
        />
      </form>,
    );
    const field = screen.getByLabelText("Weight");
    await user.click(field);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    await waitFor(() => expect(posted(container, "weight")).toBe("100"));
  });

  test("is replaced by what is typed once it is reached, as a plain field is", async () => {
    // Base UI puts the caret at the end on first focus, so tabbing to 120 and
    // typing 150 made 120150. The field selects its number instead.
    inEnglish(<NumberInput label="Value" name="value" defaultValue={120} />);
    const field = screen.getByLabelText("Value") as HTMLInputElement;
    field.focus();
    await waitFor(() => {
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(field.value.length);
    });
  });

  test("names itself a number field in the reader's language", () => {
    render(
      <TranslationsProvider locale="ms">
        <NumberInput label="Nilai" name="value" />
      </TranslationsProvider>,
    );
    expect(
      screen.getByLabelText("Nilai").getAttribute("aria-roledescription"),
    ).toBe("Medan nombor");
  });
});

describe("a metric value", () => {
  test("says where the measure starts and where it is going", () => {
    inEnglish(
      <MetricInput
        label="New value"
        name="value"
        unit="%"
        baseline={40}
        target={75}
      />,
    );
    const field = screen.getByLabelText(/New value/);
    const described = field.getAttribute("aria-describedby") ?? "";
    const hint = screen.getByText("from 40 to 75 %");
    expect(described.split(" ")).toContain(hint.id);
  });

  test("says nothing of a target nobody has set", () => {
    inEnglish(
      <MetricInput
        label="Baseline"
        name="value"
        unit="people"
        baseline={12}
        target={null}
      />,
    );
    expect(screen.queryByText(/from 12/)).toBeNull();
  });
});

describe("a unit", () => {
  test("offers the units already in use and the common ones, and keeps what is typed", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <form>
        <UnitInput label="Unit" name="unit" known={["NPS points", "%"]} />
      </form>,
    );
    const field = screen.getByLabelText("Unit");
    await user.click(field);
    await user.type(field, "p");
    // The workspace's own first, then the catalogue's, once each.
    const offered = await screen.findAllByRole("option");
    const names = offered.map((option) => option.textContent);
    expect(names).toContain("NPS points");
    expect(names).toContain("people");
    expect(names.filter((name) => name === "%")).toHaveLength(0);

    await user.clear(field);
    await user.type(field, "widgets");
    await user.tab();
    expect(posted(container, "unit")).toBe("widgets");
  });
});
