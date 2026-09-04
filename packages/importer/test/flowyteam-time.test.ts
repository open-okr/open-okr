import { describe, expect, it } from "vitest";
import { sourceInstant } from "../src/flowyteam/time.ts";

/**
 * The seven-hour bug (P6-T04b).
 *
 * Every one of these assertions is independent of the machine's timezone,
 * which is the point: the defect this function fixes is invisible on a server
 * running in UTC and shifts every imported date on one that is not.
 */
describe("sourceInstant", () => {
  it("reads a naive timestamp as UTC and not as local time", () => {
    expect(sourceInstant("2026-02-01 09:00:00")).toBe("2026-02-01T09:00:00Z");
    expect(
      new Date(sourceInstant("2026-02-01 09:00:00") as string).toISOString(),
    ).toBe("2026-02-01T09:00:00.000Z");
  });

  it("keeps a fractional second", () => {
    expect(sourceInstant("2026-02-01 09:00:00.250")).toBe(
      "2026-02-01T09:00:00.250Z",
    );
  });

  it("accepts a T as readily as a space", () => {
    expect(sourceInstant("2026-02-01T09:00:00")).toBe("2026-02-01T09:00:00Z");
  });

  it("leaves a value that already carries a zone alone", () => {
    expect(sourceInstant("2026-02-01T09:00:00+07:00")).toBe(
      "2026-02-01T09:00:00+07:00",
    );
    expect(sourceInstant("2026-02-01T09:00:00Z")).toBe("2026-02-01T09:00:00Z");
  });

  it("passes a bare date through, because a day is not an instant", () => {
    expect(sourceInstant("2026-02-01")).toBe("2026-02-01");
  });

  it("treats nothing, an empty string and MySQL's zero date as absent", () => {
    expect(sourceInstant(null)).toBeUndefined();
    expect(sourceInstant(undefined)).toBeUndefined();
    expect(sourceInstant("   ")).toBeUndefined();
    expect(sourceInstant("0000-00-00 00:00:00")).toBeUndefined();
  });

  it("takes a Date a driver already built without reinterpreting it", () => {
    const date = new Date("2026-02-01T09:00:00Z");
    expect(sourceInstant(date)).toBe("2026-02-01T09:00:00.000Z");
    expect(sourceInstant(new Date("nonsense"))).toBeUndefined();
  });
});
