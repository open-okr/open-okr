import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { keepCycle, phaseHref } from "../app/cycle/cycle-href.ts";
import { readScreen } from "./screen-text.ts";

/**
 * The annual cycle can be made and opened, and the calibration recorded, from
 * the cycle workspace (completeness review M-06, UIUX-PLAN S-04, S-11).
 *
 * **Three gaps, one screen.** The page read `cycles.current` in quarterly mode
 * and nothing else, so an annual cycle could exist and never be opened. The
 * create control passed no cadence, so it could not make one either. And
 * `workflow.calibrate` had no caller while phase 6 read "not calibrated" from
 * a hardcoded null.
 *
 * The behaviour of the writes is proved against a real database in
 * `packages/core/test/cycles.test.ts` and `cycle-workflow.test.ts`. What is
 * checked here is the wiring, and the two small functions that keep a chosen
 * cycle on every link.
 */

const at = (path: string) =>
  readScreen(fileURLToPath(new URL(path, import.meta.url)));

const page = at("../app/cycle/page.tsx");
const switcher = at("../app/cycle/cycle-switcher.tsx");
const admin = at("../app/cycle/cycle-admin.tsx");
const adminActions = at("../app/cycle/admin-actions.ts");
const actions = at("../app/cycle/actions.ts");
const cadence = at("../app/cycle/running-cadence.tsx");
const rail = at("../app/cycle/phase-rail.tsx");
const gates = at("../app/cycle/gates.tsx");

describe("opening a cycle", () => {
  test("the page opens the cycle it is asked for, then the horizon, then the quarter", () => {
    // The Work Map has linked `/cycle?cycle=<id>` since P6-G11 and the page
    // ignored it.
    expect(page).toContain('"cycles.list"');
    expect(page).toContain("one.id === query.cycle");
    expect(page).toContain('query.mode === "annual"');
    expect(page).toContain('"cycles.current", { mode }');
  });

  test("the header carries the mode toggle S-04 asks for, not a chip", () => {
    expect(page).toContain("<CycleSwitcher");
    expect(page).not.toContain("common.mode3");
    expect(switcher).toContain(`/cycle?mode=\${one}`);
    expect(switcher).toContain("Annual");
    expect(switcher).toContain("Quarterly");
    // Any cycle in the horizon, not only the one containing today: planning
    // happens before a period starts.
    expect(switcher).toContain('name="cycle"');
  });

  test("an empty horizon says so and offers the create", () => {
    expect(page).toContain("No annual cycle yet");
    // The create in an empty horizon makes that horizon's cycle.
    expect(page).toMatch(/<CycleAdmin\s+mode=\{mode\}/);
  });
});

describe("keeping the chosen cycle on every link", () => {
  test("the quarter keeps the short address every other screen uses", () => {
    expect(phaseHref(4, null)).toBe("/cycle?phase=4");
    expect(keepCycle("/cycle?phase=4", null)).toBe("/cycle?phase=4");
  });

  test("a chosen cycle travels with a phase link", () => {
    expect(phaseHref(6, "c1")).toBe("/cycle?cycle=c1&phase=6");
    expect(keepCycle("/cycle?phase=4", "c1")).toBe("/cycle?cycle=c1&phase=4");
  });

  test("a remedy that leaves the screen, or stays on the page, is left alone", () => {
    expect(keepCycle("/goals?display=diagram", "c1")).toBe(
      "/goals?display=diagram",
    );
    expect(keepCycle("#dependency-register", "c1")).toBe(
      "#dependency-register",
    );
  });

  test("the rail, the gates and the blocked banner all use them", () => {
    expect(rail).toContain("phaseHref(entry.phase, pinnedCycleId)");
    expect(gates).toContain("keepCycle(");
    expect(page).toContain("phaseHref(1, pinnedCycleId)");
    expect(page).not.toContain('href="/cycle?phase=1"');
  });
});

describe("creating a cycle", () => {
  test("asks for the horizon being read, and lets the action pick the cadence", () => {
    expect(admin).toContain("createCycle({ on, mode })");
    expect(adminActions).toContain("mode: input.mode");
    expect(adminActions).not.toContain("cadence:");
  });

  test("opens the cycle it made", () => {
    // Making next quarter or next year is how planning in it starts, and the
    // page would otherwise go on showing the one containing today.
    expect(adminActions).toContain("return { error: null, id }");
    expect(admin).toContain(`router.push(\`/cycle?cycle=\${result.id}\`)`);
  });

  test("the annual create says what an annual cycle is", () => {
    expect(admin).toContain("Create the annual cycle containing this date");
    expect(admin).toContain("starts at phase 0");
  });
});

describe("the mid-cycle calibration", () => {
  test("has a caller, and phase 6 reads what it recorded", () => {
    expect(actions).toContain('"workflow.calibrate"');
    expect(cadence).toContain("action={calibrateCycle}");
    expect(page).toContain("calibration={workflow.calibration}");
    expect(page).not.toContain("calibratedAt={null}");
  });

  test("the reason is required, as §7.6 and the action both ask", () => {
    expect(cadence).toContain('name="reason"');
    expect(cadence).toContain("required");
    expect(actions).toContain("A calibration needs its reason");
  });

  test("once used, the record replaces the form", () => {
    // §7.6 allows one. A form that can only be refused would be asking for a
    // reason nobody can record.
    expect(cadence).toMatch(
      /calibration && calibratedOn \?[\s\S]*canCalibrate \?/,
    );
    expect(cadence).toContain("This cycle has used its one calibration");
    expect(cadence).toContain('data-testid="calibration-reason"');
  });

  test("is offered only at the access the action declares", () => {
    expect(page).toContain("canCalibrate={canPublish}");
    expect(cadence).toContain("needs full access");
  });

  test("is not offered on a closed cycle, which the action refuses", () => {
    expect(page).toContain('closed={workflow.status === "closed"}');
    expect(cadence).toMatch(/closed \? null : canCalibrate \?/);
  });

  test("states §7.6 from the method package rather than in its own words", () => {
    // A paraphrase in the catalogue would be a second statement of the
    // practice, and nothing would notice it drift from METHOD.md.
    expect(cadence).toContain(
      'import { MID_CYCLE_CALIBRATION } from "@openokr/method"',
    );
    expect(cadence).toContain("MID_CYCLE_CALIBRATION.map(");
  });
});
