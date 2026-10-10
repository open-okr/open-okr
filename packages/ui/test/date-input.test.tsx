import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { relativeDate } from "../src/fields/date-format.ts";
import { DateInput } from "../src/fields/date-input.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * Dates (docs/design/guided-inputs.md §4.9): the native date control, with
 * its bounds, and a label saying when the date is from today.
 */

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">{children}</TranslationsProvider>,
  );
}

const posted = (container: HTMLElement, name: string) =>
  new FormData(container.querySelector("form") as HTMLFormElement).get(name);

describe("a date as words", () => {
  test("is a count of days while it is near", () => {
    expect(relativeDate("2026-10-22", "2026-10-10", "en")).toBe("in 12 days");
    expect(relativeDate("2026-10-11", "2026-10-10", "en")).toBe("tomorrow");
    expect(relativeDate("2026-10-10", "2026-10-10", "en")).toBe("today");
    expect(relativeDate("2026-10-07", "2026-10-10", "en")).toBe("3 days ago");
  });

  test("is its month and year when it is far, which no fiscal year reads differently", () => {
    expect(relativeDate("2027-09-30", "2026-10-10", "en")).toBe("Sep 2027");
  });

  test("is in the reader's language", () => {
    expect(relativeDate("2026-10-22", "2026-10-10", "ms")).toBe(
      "dalam 12 hari",
    );
  });

  test("is nothing for what is not a date", () => {
    expect(relativeDate("next week", "2026-10-10", "en")).toBeNull();
  });
});

describe("a date field", () => {
  test("is labelled, posts the date, and says when it is", () => {
    const { container } = inEnglish(
      <form>
        <DateInput
          label="Due"
          name="dueOn"
          defaultValue="2026-10-22"
          today="2026-10-10"
        />
      </form>,
    );
    const field = screen.getByLabelText("Due") as HTMLInputElement;
    expect(field.type).toBe("date");
    expect(posted(container, "dueOn")).toBe("2026-10-22");
    const relative = screen.getByText("in 12 days");
    expect(field.getAttribute("aria-describedby") ?? "").toContain(relative.id);
  });

  test("holds its bounds, and says why a date outside a range only warns", () => {
    inEnglish(
      <DateInput
        label="Due"
        defaultValue="2027-02-01"
        min="2026-10-01"
        max="2026-12-31"
        today="2026-10-10"
        warning="After the cycle ends on 2026-12-31."
      />,
    );
    const field = screen.getByLabelText("Due") as HTMLInputElement;
    expect(field.min).toBe("2026-10-01");
    expect(field.max).toBe("2026-12-31");
    expect(
      screen.getByText("After the cycle ends on 2026-12-31."),
    ).not.toBeNull();
  });

  test("in a table cell is named by its label alone", async () => {
    const user = userEvent.setup();
    let value: string | null = "2026-10-22";
    inEnglish(
      <DateInput
        label="Due date of Activation"
        hideLabel
        value={value}
        onValueChange={(next) => {
          value = next;
        }}
        today="2026-10-10"
      />,
    );
    const field = screen.getByLabelText(
      "Due date of Activation",
    ) as HTMLInputElement;
    expect(field.getAttribute("aria-label")).toBe("Due date of Activation");
    await user.clear(field);
    expect(value).toBeNull();
  });
});
