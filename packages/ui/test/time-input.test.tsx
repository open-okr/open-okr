import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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
    const field = screen.getByLabelText("Date and time") as HTMLInputElement;
    expect(field.type).toBe("datetime-local");
    expect(posted(container, "scheduledFor")).toBe("2026-10-12T09:00");
    const said = screen.getByText("In Asia/Jakarta time.");
    expect(field.getAttribute("aria-describedby") ?? "").toContain(said.id);
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
