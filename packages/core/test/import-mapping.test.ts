/**
 * Headers into fields, and the coercions behind them (P6-T01a).
 *
 * The acceptance criterion is about unfamiliar headers, so the alias matching
 * is the part worth proving in detail: what it catches without help, what it
 * refuses to guess, and what a supplied mapping overrides.
 */
import { describe, expect, it } from "vitest";
import {
  parseMappingFile,
  resolveMapping,
  valuesFor,
} from "../src/imports/mapping.ts";
import {
  asDay,
  asEnum,
  asNumber,
  asText,
} from "../src/imports/templates/coerce.ts";
import {
  goalsTemplate,
  keyResultsTemplate,
} from "../src/imports/templates/index.ts";

describe("matching headers by alias", () => {
  it("matches a header however it is spelled", () => {
    const mapping = resolveMapping(goalsTemplate, [
      "Objective ID",
      "Objective",
      "LEVEL",
      "quarter",
      "Champion",
      "reviewer",
    ]);
    expect(Object.keys(mapping.fieldToIndex).sort()).toEqual([
      "champion",
      "cycle",
      "externalId",
      "level",
      "reviewer",
      "title",
    ]);
  });

  it("reports a header nothing claimed rather than dropping it in silence", () => {
    const mapping = resolveMapping(goalsTemplate, [
      "id",
      "objective",
      "level",
      "quarter",
      "champion",
      "reviewer",
      "Strategic pillar",
    ]);
    expect(mapping.unmapped).toEqual(["Strategic pillar"]);
  });

  it("refuses a file that carries no column for a required field", () => {
    expect(() =>
      resolveMapping(goalsTemplate, ["id", "objective", "level"]),
    ).toThrow(/needs champion, reviewer/);
  });

  it("refuses two columns claiming one field", () => {
    expect(() =>
      resolveMapping(keyResultsTemplate, [
        "id",
        "goal",
        "title",
        "name",
        "direction",
        "baseline",
        "target",
      ]),
    ).toThrow(/Two columns claim the field "title"/);
  });

  it("lets a supplied mapping override the aliases", () => {
    const supplied = parseMappingFile(
      JSON.stringify({
        entity: "goals",
        columns: {
          Ref: "externalId",
          "What we are doing": "title",
          Tier: "level",
          Q: "cycle",
          "Runs it": "champion",
          "Checks it": "reviewer",
          "Internal notes": null,
        },
      }),
      "mapping.json",
    );
    const mapping = resolveMapping(
      goalsTemplate,
      [
        "Ref",
        "What we are doing",
        "Tier",
        "Q",
        "Runs it",
        "Checks it",
        "Internal notes",
      ],
      supplied,
    );
    expect(mapping.fieldToIndex.title).toBe(1);
    // Mapped to nothing on purpose, so not reported as unclaimed either.
    expect(mapping.unmapped).toEqual([]);
  });

  it("refuses a mapping that names a field the template does not have", () => {
    const supplied = parseMappingFile(
      JSON.stringify({ columns: { Ref: "objectiveCode" } }),
      "mapping.json",
    );
    expect(() => resolveMapping(goalsTemplate, ["Ref"], supplied)).toThrow(
      /not a field of the goals template/,
    );
  });

  it("refuses a mapping file that is not a mapping", () => {
    expect(() => parseMappingFile("{", "m.json")).toThrow(/not valid JSON/);
    expect(() => parseMappingFile("{}", "m.json")).toThrow(/needs a "columns"/);
  });

  it("reads a row into its declared fields and leaves blanks out", () => {
    const mapping = resolveMapping(keyResultsTemplate, [
      "id",
      "goal",
      "title",
      "direction",
      "baseline",
      "target",
      "unit",
    ]);
    const values = valuesFor(mapping, [
      "kr-1",
      "obj-1",
      "Weekly active teams",
      "increase",
      "10",
      "40",
      "  ",
    ]);
    expect(values).toEqual({
      externalId: "kr-1",
      goal: "obj-1",
      title: "Weekly active teams",
      direction: "increase",
      baselineValue: "10",
      targetValue: "40",
    });
  });
});

describe("coercing a cell", () => {
  it("reads a number with a thousands separator or a percent sign", () => {
    expect(asNumber("target", "1,250")).toBe(1250);
    expect(asNumber("target", "40%")).toBe(40);
  });

  it("names the cell and its contents when a number is not one", () => {
    expect(() => asNumber("target", "about forty")).toThrow(
      'target has to be a number, and it says "about forty".',
    );
  });

  it("reads the ISO day and an unambiguous slashed one", () => {
    expect(asDay("dueOn", "2026-09-30")).toBe("2026-09-30");
    expect(asDay("dueOn", "30/09/2026")).toBe("2026-09-30");
    expect(asDay("dueOn", "09/30/2026")).toBe("2026-09-30");
  });

  it("refuses a slashed date where either number could be the month", () => {
    // The one case where guessing moves a deadline by a month.
    expect(() => asDay("dueOn", "03/04/2026")).toThrow(
      /no way to tell the day from the month/,
    );
  });

  it("refuses a date that does not exist", () => {
    expect(() => asDay("dueOn", "2026-02-30")).toThrow(/not a real date/);
  });

  it("reads an enum through case and punctuation", () => {
    expect(asEnum("status", "In Progress", ["in_progress", "done"])).toBe(
      "in_progress",
    );
  });

  it("lists what an enum may say when it says something else", () => {
    expect(() => asEnum("level", "divisional", ["company", "team"])).toThrow(
      'level says "divisional". It has to be one of: company, team.',
    );
  });

  it("refuses text over its limit rather than truncating it", () => {
    expect(() => asText("title", "x".repeat(501))).toThrow(
      /rather than truncated/,
    );
  });
});
