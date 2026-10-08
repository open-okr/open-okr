/**
 * The Northwind year on the real calendar, with no database and no clock
 * (P9-T22c-a, `docs/design/northwind-year-seed.md` §2, §6).
 *
 * The acceptance: given the README's five demo dates, when the steps are read
 * as of each, then the ones the README lists are done and the next is not.
 * Proved in two real years, so it holds whatever year the demo runs in.
 */
import { describe, expect, it } from "vitest";
import { YEAR_EVENTS } from "../src/demo/year/build.ts";
import { firstMondayOf, quarterOf, toReal } from "../src/demo/year/calendar.ts";
import { YEAR_STEPS, yearStepsAsOf } from "../src/demo/year/steps.ts";
import { eventsDue, type YearEvent } from "../src/demo/year/timeline.ts";

describe("the calendar", () => {
  it("finds a quarter and its first Monday", () => {
    expect(quarterOf("2027-05-10")).toEqual({
      startsOn: "2027-04-01",
      endsOn: "2027-06-30",
    });
    expect(firstMondayOf("2027-01-01")).toBe("2027-01-04");
    expect(firstMondayOf("2026-01-01")).toBe("2026-01-05");
    expect(firstMondayOf("2026-06-01")).toBe("2026-06-01");
  });

  it("keeps each date's distance from its quarter's first Monday (the design's table)", () => {
    expect(toReal("2027-01-04", 2026)).toBe("2026-01-05");
    expect(toReal("2027-05-10", 2026)).toBe("2026-05-11");
    expect(toReal("2027-12-24", 2026)).toBe("2026-12-25");
    // "Before the year" lands in the year before.
    expect(toReal("2026-12-01", 2026)).toBe("2025-12-02");
  });

  it("keeps a Monday a Monday in any year", () => {
    for (const realYear of [2026, 2027, 2028, 2031]) {
      for (const monday of ["2027-01-18", "2027-05-10", "2027-08-09"]) {
        const landed = toReal(monday, realYear);
        expect(new Date(`${landed}T00:00:00Z`).getUTCDay()).toBe(1);
      }
    }
  });

  it("holds a date inside its quarter when the real first Monday falls later", () => {
    for (const realYear of [2026, 2027, 2028, 2029, 2030]) {
      const landed = toReal("2027-09-30", realYear);
      expect(landed <= `${realYear}-09-30`).toBe(true);
      expect(landed >= `${realYear}-07-01`).toBe(true);
    }
  });
});

describe("the steps at the README's five demo dates (§6)", () => {
  const ids = (from: string, to: string) => {
    const all = YEAR_STEPS.map((one) => one.id);
    return all.slice(all.indexOf(from), all.indexOf(to) + 1);
  };

  for (const realYear of [2026, 2027]) {
    const asOf = (scenarioDate: string) =>
      yearStepsAsOf(toReal(scenarioDate, realYear));

    it(`Q1 W2, 11 January: NW-P-01 to NW-Q1-11 done, NW-Q1-12 not yet (${realYear})`, () => {
      const states = asOf("2027-01-11");
      for (const id of ids("NW-P-01", "NW-Q1-11")) {
        expect(states.get(id), id).toBe("done");
      }
      expect(states.get("NW-Q1-12")).toBe("notYet");
    });

    it(`Q1 W6, 8 February: up to NW-Q1-19 done, NW-Q1-20 not yet (${realYear})`, () => {
      const states = asOf("2027-02-08");
      for (const id of ids("NW-P-01", "NW-Q1-19")) {
        expect(states.get(id), id).toBe("done");
      }
      expect(states.get("NW-Q1-20")).toBe("notYet");
    });

    it(`Q2 W7, 17 May: up to NW-Q2-15 done, Ben's departure under way, NW-Q2-16 not yet (${realYear})`, () => {
      const states = asOf("2027-05-17");
      for (const id of ids("NW-P-01", "NW-Q2-15")) {
        // Ben's last day is 21 May: the README's "up to NW-Q2-15" holds
        // everything but the step that is still running.
        expect(states.get(id), id).toBe(
          id === "NW-Q2-12" ? "underWay" : "done",
        );
      }
      expect(states.get("NW-Q2-16")).toBe("notYet");
    });

    it(`Q3 W7, 16 August: up to NW-Q3-10, with NW-Q3-05 and NW-Q3-06 under way (${realYear})`, () => {
      const states = asOf("2027-08-16");
      for (const id of ids("NW-P-01", "NW-Q3-10")) {
        expect(states.get(id), id).toBe(
          id === "NW-Q3-05" || id === "NW-Q3-06" ? "underWay" : "done",
        );
      }
      expect(states.get("NW-Q3-11")).toBe("notYet");
    });

    it(`24 December: the whole year done (${realYear})`, () => {
      const states = asOf("2027-12-24");
      for (const one of YEAR_STEPS) {
        expect(states.get(one.id), one.id).toBe("done");
      }
    });
  }
});

describe("the timeline runs in date order", () => {
  const event = (on: string, label: string, order?: number): YearEvent => ({
    on,
    label,
    ...(order === undefined ? {} : { order }),
    run: async () => undefined,
  });

  it("runs what is due by today, by date, then by order, then as listed", () => {
    const events = [
      event("2027-07-26", "archive Support", 100),
      event("2027-07-26", "move SU1"),
      event("2027-04-02", "cap of two"),
      event("2027-07-26", "Kofi moves"),
      event("2027-08-09", "Growth forms"),
    ];
    const today = toReal("2027-08-01", 2026);
    expect(eventsDue(events, today).map((one) => one.label)).toEqual([
      "cap of two",
      "move SU1",
      "Kofi moves",
      "archive Support",
    ]);
  });
});

describe("the story's order holds in every year the demo can run in", () => {
  /**
   * Two days the story keeps apart can land on one real day: a date before
   * its quarter's first Monday is held on the quarter's first day, which in a
   * year whose quarter starts on a Monday is that Monday too. In 2029 the
   * pilot is declared on 1 October and its first check-ins fall due the same
   * day, and they used to run first, against a pilot that did not exist yet.
   */
  it("declares the pilot before its first check-ins, even on the same real day", () => {
    for (let year = 2027; year <= 2066; year += 1) {
      const labels = eventsDue(YEAR_EVENTS, `${year}-12-31`).map(
        (event) => event.label,
      );
      const pilot = labels.indexOf(
        "The pilot quarter, a first cycle declared, and its two objectives",
      );
      const firstWeek = labels.indexOf("The pilot's check-ins, week 1");
      expect(pilot, `${year}`).toBeGreaterThanOrEqual(0);
      expect(pilot, `${year}`).toBeLessThan(firstWeek);
    }
  });

  it("never runs an event before one the story dates earlier", () => {
    for (let year = 2027; year <= 2066; year += 1) {
      const due = eventsDue(YEAR_EVENTS, `${year}-12-31`);
      for (let index = 1; index < due.length; index += 1) {
        expect(
          (due[index] as { on: string }).on >=
            (due[index - 1] as { on: string }).on,
          `${year}: ${due[index - 1]?.label} then ${due[index]?.label}`,
        ).toBe(true);
      }
    }
  });
});
