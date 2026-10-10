import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { relativeDate } from "../src/fields/date-format.ts";
import { DateInput } from "../src/fields/date-input.tsx";
import {
  type DateRange,
  DateRangeInput,
} from "../src/fields/date-range-input.tsx";
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

  test("goes back to its first date when the form resets, as after a save", async () => {
    // React resets a form whose action succeeded. A field holding its own
    // state would keep the date it had and post it with the next row.
    const user = userEvent.setup();
    const { container } = inEnglish(
      <form>
        <DateInput label="Due" name="dueOn" today="2026-10-10" />
      </form>,
    );
    const field = screen.getByLabelText("Due") as HTMLInputElement;
    await user.type(field, "2026-10-22");
    expect(screen.queryByText("in 12 days")).not.toBeNull();

    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    expect(field.value).toBe("");
    expect(posted(container, "dueOn")).toBe("");
    expect(screen.queryByText("in 12 days")).toBeNull();
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

describe("a date range", () => {
  test("posts both ends, and the end's earliest date follows the start", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <form>
        <DateRangeInput
          label="Leave"
          startLabel="From"
          endLabel="To"
          startName="startsOn"
          endName="endsOn"
          defaultValue={{ start: "2026-11-02", end: "2026-11-06" }}
          today="2026-10-10"
        />
      </form>,
    );
    expect(screen.getByRole("group", { name: "Leave" })).not.toBeNull();
    expect(posted(container, "startsOn")).toBe("2026-11-02");
    expect(posted(container, "endsOn")).toBe("2026-11-06");
    const start = screen.getByLabelText("From") as HTMLInputElement;
    const end = screen.getByLabelText("To") as HTMLInputElement;
    expect(end.min).toBe("2026-11-02");

    await user.clear(start);
    await user.type(start, "2026-11-04");
    expect(end.min).toBe("2026-11-04");
  });

  test("says under the end that it is before the start, and keeps both", async () => {
    const user = userEvent.setup();
    let range: DateRange = { start: "2026-11-02", end: "2026-11-06" };
    inEnglish(
      <DateRangeInput
        startLabel="Starts"
        endLabel="Ends"
        defaultValue={range}
        onValueChange={(next) => {
          range = next;
        }}
        today="2026-10-10"
      />,
    );
    const start = screen.getByLabelText("Starts") as HTMLInputElement;
    await user.clear(start);
    await user.type(start, "2026-11-09");
    expect(range).toEqual({ start: "2026-11-09", end: "2026-11-06" });

    const said = screen.getByRole("alert");
    expect(said.textContent).toBe(
      "Ends before it starts. Pick a date on or after 2026-11-09.",
    );
    const end = screen.getByLabelText("Ends") as HTMLInputElement;
    expect(end.getAttribute("aria-invalid")).toBe("true");
  });

  test("goes back to its first dates when the form resets", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <form>
        <DateRangeInput
          startLabel="From"
          endLabel="To"
          startName="startsOn"
          endName="endsOn"
          today="2026-10-10"
        />
      </form>,
    );
    await user.type(screen.getByLabelText("From"), "2026-11-02");
    await user.type(screen.getByLabelText("To"), "2026-11-06");
    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    expect(posted(container, "startsOn")).toBe("");
    expect(posted(container, "endsOn")).toBe("");
    expect((screen.getByLabelText("To") as HTMLInputElement).min).toBe("");
  });

  test("holds an outer bound on both ends", () => {
    inEnglish(
      <DateRangeInput
        startLabel="From"
        endLabel="To"
        min="2026-10-01"
        max="2026-12-31"
        today="2026-10-10"
      />,
    );
    const start = screen.getByLabelText("From") as HTMLInputElement;
    const end = screen.getByLabelText("To") as HTMLInputElement;
    expect([start.min, start.max]).toEqual(["2026-10-01", "2026-12-31"]);
    expect([end.min, end.max]).toEqual(["2026-10-01", "2026-12-31"]);
  });
});
