import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readKpiOptions } from "../lib/kpi-options.ts";
import { withMessages } from "./screen-text.ts";

/**
 * KPI-backed key results in the browser (TECHNICAL-PLAN §6.2, completeness
 * review M-07).
 *
 * `goals.addKeyResult` has always taken a KPI and no screen ever sent one, and
 * nothing at all could link a KPI to a key result that already existed. The
 * link, the refusals and the recompute are proved against a real database in
 * `packages/core/test/kpi-linked-key-results.test.ts`, and the end-to-end
 * spec `s09c-kpi-backed-key-results` drives the whole path. What is checked
 * here is the decision in each control: where it is offered, what it
 * defaults to, and what it says when there is nothing to pick.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const drafting = at("../app/cycle/drafting.tsx");
const draftingActions = at("../app/cycle/goal-actions.ts");
const cyclePage = at("../app/cycle/page.tsx");
const goalPage = at("../app/goals/[id]/page.tsx");
const goalWrites = at("../app/goals/[id]/goal-writes.tsx");
const writeActions = at("../app/goals/[id]/write-actions.ts");
const options = at("../lib/kpi-options.ts");

describe("drafting a key result on the cycle's phase 4", () => {
  test("sends the chosen KPI with the key result", () => {
    expect(draftingActions).toContain('formData.get("kpiId")');
    expect(draftingActions).toContain('...(kpiId === "" ? {} : { kpiId })');
  });

  test("defaults to a key result measured by hand", () => {
    // A default that wired every new key result to the first KPI in the list
    // would be a decision nobody made.
    expect(drafting).toContain('name="kpiId"');
    expect(drafting).toContain('defaultValue=""');
    expect(withMessages(drafting)).toContain("Measured by hand");
  });

  test("says why there is no choice, whether the list is empty or unreadable", () => {
    const text = withMessages(drafting);
    expect(drafting).toContain("kpis === null ?");
    expect(text).toContain("The KPI list could not be read just now");
    expect(drafting).toContain("kpis.length === 0 ?");
    expect(text).toContain("No KPIs to read from yet");
    expect(drafting).toContain('href="/kpis"');
  });

  test("names each form after its objective", () => {
    // Six identical "add a key result" forms are six identical landmarks to a
    // screen reader, and the end-to-end spec needs to find one of them.
    expect(drafting).toContain('"cycle.drafting.addKeyResultTo"');
    expect(at("../app/cycle/action-form.tsx")).toContain("aria-label={label}");
  });

  test("reads the KPIs only on the step that offers them", () => {
    expect(cyclePage).toContain("kpis: await readKpiOptions(context)");
    expect(cyclePage).toContain("kpis={draft.kpis}");
  });
});

describe("linking a KPI on the goal page", () => {
  test("reaches the action that had no caller", () => {
    expect(writeActions).toContain('"goals.linkKpi"');
    expect(goalWrites).toContain("linkKeyResultKpi({ id: linking, kpiId })");
  });

  test("is offered for a key result measured by hand, on an open goal, to an editor", () => {
    expect(goalPage).toContain("canEdit && !closed");
    expect(goalPage).toContain("keyResult.kpiId === null");
    expect(goalWrites).toContain("unlinkedKeyResults.length > 0 ?");
  });

  test("reads the KPI list only when there is something to link", () => {
    expect(goalPage).toContain(
      "unlinkedKeyResults.length > 0 ? await readKpiOptions(context) : []",
    );
  });

  test("says why there is no choice, whether the list is empty or unreadable", () => {
    const text = withMessages(goalWrites);
    expect(text).toContain("The KPI list could not be read just now");
    expect(text).toContain("No KPIs to link to yet.");
    // And what linking does, because the reading that it merely labels the
    // key result is the one that would surprise somebody.
    expect(text).toContain("a typed value is refused until it is unlinked");
  });

  test("never sends a key result the last link already took", () => {
    // A successful link refreshes the list, and a choice still pointing at
    // the key result just linked would send a link the server refuses.
    expect(goalWrites).toContain(
      "unlinkedKeyResults.some((row) => row.id === pickedKeyResult)",
    );
  });
});

describe("the KPI list both pickers read", () => {
  test("comes from the registry read, not from a query of its own", () => {
    expect(options).toContain('"kpis.list"');
    expect(options).not.toContain("drizzle");
  });

  test("is null rather than a thrown page when it cannot be read", async () => {
    // A pool that refuses every connection stands in for a database that is
    // down. The picker says so and the rest of the screen still renders.
    const pool = {
      connect: () => Promise.reject(new Error("the database is down")),
      query: () => Promise.reject(new Error("the database is down")),
    };
    const result = await readKpiOptions({
      pool: pool as never,
      workspaceId: "00000000-0000-4000-8000-000000000000",
      actor: { kind: "human", userId: "nobody" },
    });
    expect(result).toBeNull();
  });
});
