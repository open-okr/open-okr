import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  addDays,
  cyclePeriodFor,
  cyclePeriodsFrom,
  formatLocalDate,
  localDateIn,
  nextCyclePeriod,
  parseLocalDate,
  statusForDate,
} from "../src/cycles/generation.ts";
import { resolveRhythm, validateRhythmPatch } from "../src/cycles/rhythm.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The annual frame, cycles and rhythm settings (P3-T02, TECHNICAL-PLAN §4.3,
 * METHOD.md §2.1, §11).
 *
 * The task's own acceptance criterion is the first test under "the period
 * containing a date": quarterly cadence on a date inside Q3 gives Q3 with the
 * right bounds, created automatically if absent.
 *
 * Its test plan asks for three more things, and each has its own group below:
 * generation across quarter, half and year boundaries and across timezones; a
 * threshold change taking effect without a restart; and label overrides that
 * reach every reader.
 */

const OWNER = "cycles-owner";

let workspaceId: string;

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Cycles Owner", "cycles-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Cycles Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the period containing a date", () => {
  it("gives Q3 with the right bounds for a date inside Q3", () => {
    // The task's acceptance criterion, as arithmetic.
    const period = cyclePeriodFor("quarterly", parseLocalDate("2026-08-11"));
    expect(period.name).toBe("Q3 2026");
    expect(period.startsOn).toBe("2026-07-01");
    expect(period.endsOn).toBe("2026-09-30");
    expect(period.mode).toBe("quarterly");
  });

  const quarters: Array<[string, string, string, string]> = [
    ["2026-01-01", "Q1 2026", "2026-01-01", "2026-03-31"],
    ["2026-03-31", "Q1 2026", "2026-01-01", "2026-03-31"],
    ["2026-04-01", "Q2 2026", "2026-04-01", "2026-06-30"],
    ["2026-06-30", "Q2 2026", "2026-04-01", "2026-06-30"],
    ["2026-07-01", "Q3 2026", "2026-07-01", "2026-09-30"],
    ["2026-09-30", "Q3 2026", "2026-07-01", "2026-09-30"],
    ["2026-10-01", "Q4 2026", "2026-10-01", "2026-12-31"],
    ["2026-12-31", "Q4 2026", "2026-10-01", "2026-12-31"],
  ];

  for (const [on, name, startsOn, endsOn] of quarters) {
    it(`puts ${on} in ${name}`, () => {
      const period = cyclePeriodFor("quarterly", parseLocalDate(on));
      expect([period.name, period.startsOn, period.endsOn]).toEqual([
        name,
        startsOn,
        endsOn,
      ]);
    });
  }

  it("splits a half year at the end of June", () => {
    expect(
      cyclePeriodFor("semiannual", parseLocalDate("2026-06-30")).name,
    ).toBe("H1 2026");
    expect(
      cyclePeriodFor("semiannual", parseLocalDate("2026-06-30")).endsOn,
    ).toBe("2026-06-30");
    expect(
      cyclePeriodFor("semiannual", parseLocalDate("2026-07-01")).name,
    ).toBe("H2 2026");
  });

  it("runs an annual cycle from January to December, in annual mode", () => {
    const period = cyclePeriodFor("annual", parseLocalDate("2026-08-11"));
    expect([period.name, period.startsOn, period.endsOn, period.mode]).toEqual([
      "2026",
      "2026-01-01",
      "2026-12-31",
      "annual",
    ]);
  });

  it("ends a monthly cycle on the real last day, February included", () => {
    expect(cyclePeriodFor("monthly", parseLocalDate("2026-02-10")).endsOn).toBe(
      "2026-02-28",
    );
    expect(cyclePeriodFor("monthly", parseLocalDate("2028-02-10")).endsOn).toBe(
      "2028-02-29",
    );
    expect(cyclePeriodFor("monthly", parseLocalDate("2026-02-10")).name).toBe(
      "February 2026",
    );
  });

  it("crosses a year boundary into the next period", () => {
    expect(
      nextCyclePeriod("quarterly", parseLocalDate("2026-11-15")).name,
    ).toBe("Q1 2027");
    expect(nextCyclePeriod("annual", parseLocalDate("2026-11-15")).name).toBe(
      "2027",
    );
    expect(nextCyclePeriod("monthly", parseLocalDate("2026-12-15")).name).toBe(
      "January 2027",
    );
  });

  it("generates a forward run without a gap or an overlap", () => {
    const periods = cyclePeriodsFrom(
      "quarterly",
      parseLocalDate("2026-08-11"),
      6,
    );
    expect(periods.map((period) => period.name)).toEqual([
      "Q3 2026",
      "Q4 2026",
      "Q1 2027",
      "Q2 2027",
      "Q3 2027",
      "Q4 2027",
    ]);
    for (let index = 1; index < periods.length; index++) {
      const previousEnd = parseLocalDate(periods[index - 1]?.endsOn as string);
      expect(formatLocalDate(addDays(previousEnd, 1))).toBe(
        periods[index]?.startsOn,
      );
    }
  });
});

describe("the timezone a cycle is read in", () => {
  /**
   * The case that makes this matter. At this instant it is already the 1st of
   * July in Jakarta and still the 30th of June in New York, so the two are in
   * different quarters, and a workspace must see its own.
   */
  const instant = new Date("2026-06-30T18:00:00Z");

  it("puts one instant in different quarters for different workspaces", () => {
    expect(
      cyclePeriodFor("quarterly", localDateIn(instant, "Asia/Jakarta")).name,
    ).toBe("Q3 2026");
    expect(
      cyclePeriodFor("quarterly", localDateIn(instant, "America/New_York"))
        .name,
    ).toBe("Q2 2026");
  });

  it("reads the same instant as different years across a new year", () => {
    const newYear = new Date("2026-12-31T20:00:00Z");
    expect(localDateIn(newYear, "Asia/Jakarta").year).toBe(2027);
    expect(localDateIn(newYear, "America/New_York").year).toBe(2026);
  });

  it("is unaffected by daylight saving, because a calendar date has no offset", () => {
    // 2026-03-29 is the European spring shift. The date is the date either side.
    const before = new Date("2026-03-28T12:00:00Z");
    const after = new Date("2026-03-30T12:00:00Z");
    expect(formatLocalDate(localDateIn(before, "Europe/Berlin"))).toBe(
      "2026-03-28",
    );
    expect(formatLocalDate(localDateIn(after, "Europe/Berlin"))).toBe(
      "2026-03-30",
    );
  });
});

describe("the status a cycle should hold", () => {
  const period = { startsOn: "2026-07-01", endsOn: "2026-09-30" };

  it("is planning before it starts", () => {
    expect(statusForDate(period, parseLocalDate("2026-06-30"), false)).toBe(
      "planning",
    );
  });

  it("is planning inside its dates while it is unpublished", () => {
    // METHOD.md §2.3: a cycle becomes active when it is published at phase 5,
    // not when its first day arrives.
    expect(statusForDate(period, parseLocalDate("2026-08-01"), false)).toBe(
      "planning",
    );
  });

  it("is active inside its dates once published", () => {
    expect(statusForDate(period, parseLocalDate("2026-08-01"), true)).toBe(
      "active",
    );
  });

  it("is closing after it ends, never closed", () => {
    // Closing is an act with a scoring session behind it (P3-T15), not a date.
    expect(statusForDate(period, parseLocalDate("2026-10-01"), true)).toBe(
      "closing",
    );
  });
});

describe("provisioning a workspace", () => {
  it("puts it inside a cycle straight away", async () => {
    const wb = await workerDb();
    const current = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.current",
      { mode: "quarterly" },
    );
    expect(current).not.toBeNull();
    expect(current?.status).toBe("planning");
    expect(current?.phase).toBe(1);
    // §2.7: individual goals are optional, so the default set stops at team.
    expect(current?.levels).toEqual(["company", "department", "team"]);
  });

  it("gives it the canon rhythm, with no deviations", async () => {
    const wb = await workerDb();
    const rhythm = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(rhythm.overrides).toEqual({});
    expect(rhythm.defaultCheckInFrequency).toBe("weekly");
    expect(rhythm.checkInAnchorDay).toBe(1);
    expect(rhythm.coachStrictness).toBe("warn");
    expect(rhythm.thresholds["cadence.stalenessGraceDays"]).toBe(3);
    expect(rhythm.terminology.objective).toEqual({
      singular: "Objective",
      plural: "Objectives",
    });
  });

  it("describes every parameter so an admin card can render it", async () => {
    const wb = await workerDb();
    const rhythm = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(rhythm.registry.length).toBeGreaterThan(40);
    const anchor = rhythm.registry.find(
      (entry) => entry.key === "cadence.anchorDay",
    );
    expect(anchor?.columnBacked).toBe(true);
    const grace = rhythm.registry.find(
      (entry) => entry.key === "cadence.stalenessGraceDays",
    );
    expect(grace?.columnBacked).toBe(false);
    expect(grace?.section).toBe("§3.5");
  });
});

describe("ensuring the current cycle", () => {
  it("is idempotent: the second call creates nothing", async () => {
    const wb = await workerDb();
    const first = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.ensureCurrent",
      {},
    );
    // Provisioning already made it, so even the first call finds one.
    expect(first.created).toBe(false);

    const second = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.ensureCurrent",
      {},
    );
    expect(second.id).toBe(first.id);

    const all = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.list",
      {},
    );
    expect(all).toHaveLength(1);
  });
});

describe("creating a cycle by hand", () => {
  it("creates the period containing the date it is given", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.create",
      { on: "2027-05-14", firstCycle: false },
    );
    expect(created.name).toBe("Q2 2027");
    expect(created.startsOn).toBe("2027-04-01");
    expect(created.endsOn).toBe("2027-06-30");
  });

  it("refuses a period the workspace already has", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "cycles.create", {
      on: "2027-05-14",
      firstCycle: false,
    });
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "cycles.create", {
        on: "2027-06-01",
        firstCycle: false,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it("refuses a publication deadline that falls after the cycle starts", async () => {
    // METHOD.md §4.5 gate 6: a publication date is set before day one. Refused
    // where somebody sets it, not only when the gate is evaluated.
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "cycles.create", {
        on: "2027-05-14",
        firstCycle: false,
        publicationDeadline: "2027-04-15",
      }),
    ).rejects.toThrow(/before day one/i);
  });

  it("accepts a deadline before day one", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.create",
      {
        on: "2027-05-14",
        firstCycle: false,
        publicationDeadline: "2027-03-25",
      },
    );
    expect(created.publicationDeadline).toBe("2027-03-25");
  });
});

describe("archiving a cycle", () => {
  it("drops it from the list", async () => {
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.create",
      { on: "2027-05-14", firstCycle: false },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.archive",
      {
        id: created.id,
      },
    );
    const all = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "cycles.list",
      {},
    );
    expect(all.map((cycle) => cycle.id)).not.toContain(created.id);
  });
});

describe("changing a threshold", () => {
  it("takes effect on the next read, with no restart", async () => {
    // The §11 promise the whole registry rests on: nothing caches a threshold.
    const wb = await workerDb();
    const before = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(before.thresholds["cadence.stalenessGraceDays"]).toBe(3);

    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      overrides: { "cadence.stalenessGraceDays": 5 },
    });

    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(after.thresholds["cadence.stalenessGraceDays"]).toBe(5);
    expect(after.overrides).toEqual({ "cadence.stalenessGraceDays": 5 });
  });

  it("keeps every other threshold at the canon", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      overrides: { "cadence.stalenessGraceDays": 5 },
    });
    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(after.thresholds["cadence.toleranceDays"]).toBe(1);
    expect(after.thresholds["alignment.healthyThreshold"]).toBe(75);
  });

  it("merges one key at a time rather than replacing the map", async () => {
    const wb = await workerDb();
    const call = (overrides: Record<string, unknown>) =>
      callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
        overrides,
      });
    await call({ "cadence.stalenessGraceDays": 5 });
    await call({ "alignment.healthyThreshold": 80 });
    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(after.overrides).toEqual({
      "cadence.stalenessGraceDays": 5,
      "alignment.healthyThreshold": 80,
    });
  });

  it("returns a single threshold to the canon when it is set to null", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      overrides: { "cadence.stalenessGraceDays": 5 },
    });
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      overrides: { "cadence.stalenessGraceDays": null },
    });
    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(after.overrides).toEqual({});
    expect(after.thresholds["cadence.stalenessGraceDays"]).toBe(3);
  });

  /**
   * Found in a browser, not in a test. The admin card submits every field it
   * renders, so a save with nothing changed wrote the whole canon into the
   * override map. Storing a deviation that matches the canon looks harmless and
   * is not: the stored copy keeps winning after the canon itself changes, so a
   * workspace that never chose anything would silently hold yesterday's value.
   */
  it("stores nothing when a threshold is set to the canon value", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      overrides: {
        "cadence.stalenessGraceDays": 3,
        "kpi.healthyThreshold": 90,
      },
    });
    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(after.overrides).toEqual({});
    expect(after.thresholds["cadence.stalenessGraceDays"]).toBe(3);
  });

  it("clears an existing deviation reverted to the canon value", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      overrides: { "cadence.stalenessGraceDays": 5 },
    });
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      overrides: { "cadence.stalenessGraceDays": 3 },
    });
    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(after.overrides).toEqual({});
  });

  it("stores no label for a term submitted at its canon word", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      labels: {
        objective: { singular: "Objective", plural: "Objectives" },
        champion: { singular: "Owner", plural: "Owners" },
      },
    });
    const wb2 = await workerDb();
    const stored = await wb2.admin.query<{ labels: Record<string, unknown> }>(
      "select labels from rhythm_settings where workspace_id = $1",
      [workspaceId],
    );
    expect(Object.keys(stored.rows[0]?.labels ?? {})).toEqual(["champion"]);
  });

  it("refuses a value outside the parameter's range", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
        overrides: { "scoring.confidenceHigh": 4 },
      }),
    ).rejects.toThrow();
  });

  it("refuses a threshold that is not in the registry", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
        overrides: { "cadence.inventedByMe": 4 },
      }),
    ).rejects.toThrow(/registry/i);
  });

  it("refuses a column-backed threshold inside the override map", async () => {
    // One value with two homes is a value nobody owns. The anchor day has its own
    // column, so the map is not where it goes.
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
        overrides: { "cadence.anchorDay": 3 },
      }),
    ).rejects.toThrow(/own column/i);
  });

  it("accepts the anchor day through its own column", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      checkInAnchorDay: 3,
      defaultCheckInFrequency: "biweekly",
      coachStrictness: "strict",
    });
    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(after.checkInAnchorDay).toBe(3);
    // And the resolved set reflects the columns, so one flat map still answers
    // every threshold question.
    expect(after.thresholds["cadence.anchorDay"]).toBe(3);
    expect(after.thresholds["cadence.checkInFrequency"]).toBe("biweekly");
    expect(after.thresholds["quality.coachStrictness"]).toBe("strict");
  });
});

describe("renaming a term", () => {
  it("reaches every reader of the resolved terminology", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
      labels: { objective: { singular: "Ambition", plural: "Ambitions" } },
    });
    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "rhythm.read",
      {},
    );
    expect(after.terminology.objective).toEqual({
      singular: "Ambition",
      plural: "Ambitions",
    });
    expect(after.terminology.keyResult).toEqual({
      singular: "Key result",
      plural: "Key results",
    });
  });

  it("refuses a term the method does not define", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "rhythm.update", {
        labels: { initiative: { singular: "Project", plural: "Projects" } },
      }),
    ).rejects.toThrow();
  });
});

describe("resolving the rhythm from a row", () => {
  it("lets the columns win over a stale map entry", () => {
    // A row written before the refusal existed could hold the anchor day in both
    // places. The column is what the admin screen shows, so the column wins.
    const resolved = resolveRhythm({
      defaultCheckInFrequency: "monthly",
      checkInAnchorDay: 4,
      coachStrictness: "advisory",
      overrides: { "cadence.anchorDay": 7, "cadence.toleranceDays": 2 },
      labels: {},
    });
    expect(resolved.thresholds["cadence.anchorDay"]).toBe(4);
    expect(resolved.thresholds["cadence.toleranceDays"]).toBe(2);
    expect(resolved.thresholds["cadence.checkInFrequency"]).toBe("monthly");
  });

  it("resolves the canon for a workspace with no row at all", () => {
    // "Every setting has a working default and nothing must be configured before
    // the product works" has to survive a missing row.
    const resolved = resolveRhythm(null);
    expect(resolved.thresholds["cadence.stalenessGraceDays"]).toBe(3);
    expect(resolved.terminology.champion.singular).toBe("Champion");
  });

  it("reports every problem in a patch at once", () => {
    const { problems } = validateRhythmPatch({
      checkInAnchorDay: 9,
      overrides: { "cadence.anchorDay": 2, "scoring.confidenceHigh": 5 },
    });
    expect(problems).toHaveLength(3);
  });
});

describe("the annual frame", () => {
  it("starts absent, because nothing must be configured first", async () => {
    const wb = await workerDb();
    expect(
      await callAction(
        { pool: wb.appPool, ...context(OWNER) },
        "frame.read",
        {},
      ),
    ).toBeNull();
  });

  it("records the year, the horizon and two to five thrusts", async () => {
    const wb = await workerDb();
    const set = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "frame.set",
      {
        yearLabel: "2027",
        horizonLabel: "Three years out",
        agreed: true,
        strategies: [
          { text: "Win the mid-market" },
          { text: "Make onboarding self-serve", note: "Cuts support load" },
        ],
      },
    );
    expect(set.strategies).toHaveLength(2);
    const read = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "frame.read",
      {},
    );
    expect(read?.yearLabel).toBe("2027");
    expect(read?.agreed).toBe(true);
    expect(read?.strategies.map((s) => s.text)).toEqual([
      "Win the mid-market",
      "Make onboarding self-serve",
    ]);
  });

  it("edits the same year in place rather than superseding it", async () => {
    const wb = await workerDb();
    const first = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "frame.set",
      { yearLabel: "2027", agreed: false, strategies: [{ text: "One" }] },
    );
    const second = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "frame.set",
      {
        yearLabel: "2027",
        agreed: false,
        strategies: [{ text: "One" }, { text: "Two" }],
      },
    );
    // A correction inside the year is a correction, not a new frame: recording
    // it as a supersession would make the history unreadable.
    expect(second.id).toBe(first.id);
    expect(second.strategies).toHaveLength(2);
  });

  it("supersedes the old frame when the year changes", async () => {
    const wb = await workerDb();
    const first = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "frame.set",
      { yearLabel: "2027", agreed: false, strategies: [{ text: "One" }] },
    );
    const second = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "frame.set",
      { yearLabel: "2028", agreed: false, strategies: [{ text: "Two" }] },
    );
    expect(second.id).not.toBe(first.id);

    // Exactly one current frame, and it is the new one (§2.1: a frame is never
    // rewritten mid-year).
    const read = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "frame.read",
      {},
    );
    expect(read?.id).toBe(second.id);
    expect(read?.yearLabel).toBe("2028");

    const rows = await wb.admin.query(
      "select count(*)::int as n from annual_frames where workspace_id = $1 and superseded_at is null",
      [workspaceId],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });
});
