import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, test } from "vitest";
import { DateTimeInput } from "../src/fields/date-time-input.tsx";
import { TimeInput, TimeRangeInput } from "../src/fields/time-input.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * Times (docs/design/guided-inputs.md §4.9): a time on a clock, a window of
 * the day, and a date and time with the zone it is read in.
 */

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">
      <form>{children}</form>
    </TranslationsProvider>,
  );
}

const posted = (container: HTMLElement, name: string) =>
  new FormData(container.querySelector("form") as HTMLFormElement).get(name);

describe("a time", () => {
  test("is labelled, says whose clock it is, and posts HH:MM", () => {
    const { container } = inEnglish(
      <TimeInput
        label="Send the summary at"
        name="dailySummaryTime"
        defaultValue="08:00"
        description="In your own timezone."
      />,
    );
    const field = screen.getByLabelText(
      "Send the summary at",
    ) as HTMLInputElement;
    expect(field.type).toBe("time");
    expect(posted(container, "dailySummaryTime")).toBe("08:00");
    const said = screen.getByText("In your own timezone.");
    expect(field.getAttribute("aria-describedby") ?? "").toContain(said.id);
  });

  test("shows a time saved as 9:30, rather than an empty field a save would clear", () => {
    const { container } = inEnglish(
      <TimeInput label="Start" name="start" defaultValue="9:30" />,
    );
    expect(posted(container, "start")).toBe("09:30");
  });
});

describe("a window of the day", () => {
  const quiet = (defaultValue?: { start: string; end: string }) => (
    <TimeRangeInput
      label="Quiet hours"
      startLabel="Quiet hours start"
      endLabel="Quiet hours end"
      startName="quietStart"
      endName="quietEnd"
      {...(defaultValue ? { defaultValue } : {})}
    />
  );

  test("opens on the saved window, which may run overnight", () => {
    const { container } = inEnglish(quiet({ start: "22:00", end: "7:00" }));
    expect(screen.getByRole("group", { name: "Quiet hours" })).not.toBeNull();
    expect(posted(container, "quietStart")).toBe("22:00");
    expect(posted(container, "quietEnd")).toBe("07:00");
    expect(screen.queryByRole("alert")).toBeNull();
    // Neither is required while both or neither are set: empty is "off".
    for (const label of ["Quiet hours start", "Quiet hours end"]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).required).toBe(
        false,
      );
    }
  });

  test("says under the empty one that it takes both or neither, once the pair is left", async () => {
    const user = userEvent.setup();
    inEnglish(
      <>
        {quiet()}
        <button type="button">Elsewhere</button>
      </>,
    );
    await user.type(screen.getByLabelText("Quiet hours start"), "22:00");
    // Still on the way to the second time: nothing said yet.
    await user.click(screen.getByLabelText("Quiet hours end"));
    expect(screen.queryByRole("alert")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Give both times, or clear both.",
    );
    const end = screen.getByLabelText("Quiet hours end") as HTMLInputElement;
    expect(end.getAttribute("aria-invalid")).toBe("true");
    // And the form will not send one time alone.
    expect(end.required).toBe(true);
    expect(end.checkValidity()).toBe(false);
  });

  test("goes back to the saved window when the form resets", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(quiet({ start: "22:00", end: "07:00" }));
    const start = screen.getByLabelText("Quiet hours start");
    await user.clear(start);
    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    expect(posted(container, "quietStart")).toBe("22:00");
  });
});

describe("a date and time", () => {
  test("names the zone it is read in, and posts the local time without one", () => {
    const { container } = inEnglish(
      <DateTimeInput
        label="Date and time"
        name="scheduledFor"
        defaultValue="2026-10-12T09:00"
        timeZone="Asia/Jakarta"
      />,
    );
    const field = screen.getByLabelText(
      "Date and time: date",
    ) as HTMLInputElement;
    expect(field.type).toBe("date");
    expect(
      (screen.getByLabelText("Date and time: time") as HTMLInputElement).type,
    ).toBe("time");
    expect(posted(container, "scheduledFor")).toBe("2026-10-12T09:00");
    const said = screen.getByText("In Asia/Jakarta time.");
    expect(
      screen
        .getByRole("group", { name: "Date and time" })
        .getAttribute("aria-describedby"),
    ).toBe(said.id);
  });

  test("with no zone given, reads the browser's and posts it beside the time", () => {
    const { container } = inEnglish(
      <DateTimeInput
        label="Shows from"
        name="startsAt"
        zoneName="startsAtZone"
        defaultValue="2026-10-12T09:00"
      />,
    );
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(posted(container, "startsAtZone")).toBe(zone);
    expect(screen.getByText(`In ${zone} time.`)).not.toBeNull();
  });
});

function ControlledDateTime({
  onChange,
}: {
  readonly onChange: (next: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <DateTimeInput
      label="When"
      name="when"
      value={value}
      onValueChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe("the shared date picker in datetime fields", () => {
  const date = () => screen.getByLabelText("When: date") as HTMLInputElement;
  const time = () => screen.getByLabelText("When: time") as HTMLInputElement;
  const change = (input: HTMLInputElement, value: string) =>
    fireEvent.change(input, { target: { value } });

  test("posts one combined field and keeps a date while the time is entered", () => {
    const { container } = inEnglish(<DateTimeInput label="When" name="when" />);
    change(date(), "2026-11-06");
    expect(date().value).toBe("2026-11-06");
    expect(posted(container, "when")).toBe("");
    expect(time().required).toBe(true);
    expect(
      (container.querySelector("form") as HTMLFormElement).checkValidity(),
    ).toBe(false);
    change(time(), "09:30");
    expect(posted(container, "when")).toBe("2026-11-06T09:30");
    expect([
      ...new FormData(
        container.querySelector("form") as HTMLFormElement,
      ).keys(),
    ]).toEqual(["when"]);
  });

  test("also accepts entering the time before the date", () => {
    const { container } = inEnglish(<DateTimeInput label="When" name="when" />);
    change(time(), "09:30");
    expect(date().required).toBe(true);
    change(date(), "2026-11-06");
    expect(posted(container, "when")).toBe("2026-11-06T09:30");
  });

  test("keeps partial input with a controlled parent and reports complete values or null", () => {
    const changes: (string | null)[] = [];
    const { container } = inEnglish(
      <ControlledDateTime onChange={(next) => changes.push(next)} />,
    );
    change(date(), "2026-11-06");
    expect(date().value).toBe("2026-11-06");
    change(time(), "09:30");
    expect(posted(container, "when")).toBe("2026-11-06T09:30");
    change(date(), "");
    expect(time().value).toBe("09:30");
    expect(posted(container, "when")).toBe("");
    change(date(), "2026-11-07");
    expect(posted(container, "when")).toBe("2026-11-07T09:30");
    expect(changes).toEqual([
      null,
      "2026-11-06T09:30",
      null,
      "2026-11-07T09:30",
    ]);
  });

  test("does not override a controlled value when its parent declines a change", () => {
    inEnglish(<DateTimeInput label="When" value="2026-11-06T09:30" />);
    change(date(), "2026-11-07");
    expect(date().value).toBe("2026-11-06");
    expect(time().value).toBe("09:30");
  });

  test("follows externally replaced values without reviving an old partial draft", () => {
    const view = (value: string | null) => (
      <TranslationsProvider locale="en">
        <form>
          <DateTimeInput label="When" name="when" value={value} />
        </form>
      </TranslationsProvider>
    );
    const { rerender, container } = render(view(null));
    change(date(), "2026-11-06");
    expect(date().value).toBe("2026-11-06");
    rerender(view("2026-11-08T14:00"));
    expect(date().value).toBe("2026-11-08");
    expect(time().value).toBe("14:00");
    rerender(view(null));
    expect(date().value).toBe("");
    expect(time().value).toBe("");
    expect(posted(container, "when")).toBe("");
  });

  test("clearing both fields leaves an optional form valid", () => {
    const { container } = inEnglish(
      <DateTimeInput
        label="When"
        name="when"
        defaultValue="2026-11-06T09:30"
      />,
    );
    change(time(), "");
    change(date(), "");
    expect(posted(container, "when")).toBe("");
    expect(
      (container.querySelector("form") as HTMLFormElement).checkValidity(),
    ).toBe(true);
  });

  test("resets both parts and the posted value to the original default", () => {
    const { container } = inEnglish(
      <DateTimeInput
        label="When"
        name="when"
        defaultValue="2026-11-06T09:30"
      />,
    );
    change(date(), "2026-11-07");
    change(time(), "10:00");
    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    expect(date().value).toBe("2026-11-06");
    expect(time().value).toBe("09:30");
    expect(posted(container, "when")).toBe("2026-11-06T09:30");
  });

  test("clears partial drafts when an empty form resets", () => {
    const { container } = inEnglish(<DateTimeInput label="When" name="when" />);
    change(date(), "2026-11-06");
    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    expect(date().value).toBe("");
    expect(time().value).toBe("");
    expect(date().required).toBe(false);
    expect(time().required).toBe(false);
  });

  test("requires both parts only when required or partially filled", () => {
    const { container } = inEnglish(<DateTimeInput label="When" required />);
    expect(date().required).toBe(true);
    expect(time().required).toBe(true);
    expect(
      (container.querySelector("form") as HTMLFormElement).checkValidity(),
    ).toBe(false);
    change(date(), "2026-11-06");
    change(time(), "09:30");
    expect(
      (container.querySelector("form") as HTMLFormElement).checkValidity(),
    ).toBe(true);
  });

  test("excludes disabled datetime and zone fields from submission", () => {
    const { container } = inEnglish(
      <DateTimeInput
        label="When"
        name="when"
        zoneName="zone"
        timeZone="Asia/Jakarta"
        defaultValue="2026-11-06T09:30"
        disabled
      />,
    );
    expect(date().disabled).toBe(true);
    expect(time().disabled).toBe(true);
    expect(posted(container, "when")).toBeNull();
    expect(posted(container, "zone")).toBeNull();
  });

  test("enforces time bounds on boundary days and releases them on intervening days", () => {
    inEnglish(
      <DateTimeInput
        label="When"
        min="2026-11-06T09:30"
        max="2026-11-08T17:00"
        defaultValue="2026-11-06T09:00"
      />,
    );
    expect([date().min, date().max]).toEqual(["2026-11-06", "2026-11-08"]);
    expect(time().min).toBe("09:30");
    expect(time().checkValidity()).toBe(false);
    change(date(), "2026-11-07");
    expect([time().min, time().max]).toEqual(["", ""]);
    expect(time().checkValidity()).toBe(true);
    change(date(), "2026-11-08");
    change(time(), "17:01");
    expect(time().max).toBe("17:00");
    expect(time().checkValidity()).toBe(false);
    change(time(), "17:00");
    expect(time().checkValidity()).toBe(true);
    change(date(), "2026-11-09");
    expect(date().checkValidity()).toBe(false);
  });

  test("keeps both time bounds on a single permitted day", () => {
    inEnglish(
      <DateTimeInput
        label="When"
        min="2026-11-06T09:30"
        max="2026-11-06T17:00"
        defaultValue="2026-11-06T12:00"
      />,
    );
    expect([time().min, time().max]).toEqual(["09:30", "17:00"]);
    expect(time().checkValidity()).toBe(true);
  });
});
