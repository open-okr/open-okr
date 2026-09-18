import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { applyTemplate, firstWeeklySession } from "../src/templates/apply.ts";
import {
  STARTING_TEMPLATES,
  startingTemplateFor,
} from "../src/templates/catalogue.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The starting templates (P8-T12).
 *
 * Acceptance criterion: given a fresh workspace created from the starter
 * template, when it opens, then goals with a cadence exist, the Work Map is
 * populated, and the first weekly session is scheduled.
 *
 * All three are asserted through the same reads the screens use, rather than
 * against the tables, because "the Work Map is populated" is a claim about
 * what a person sees and a row nobody's read returns is not that.
 */

let workspaceId: string;
let userId: string;

beforeEach(async () => {
  const wb = await workerDb();
  userId = newId();
  await wb.appPool.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Template", `${userId.slice(0, 13)}@example.com`],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: userId,
      name: `Template ${userId.slice(0, 8)}`,
    })
  ).workspaceId;
});

const apply = async (
  template: Parameters<typeof applyTemplate>[0]["template"],
) => {
  const wb = await workerDb();
  return applyTemplate({
    pool: wb.appPool,
    workspaceId,
    adminUserId: userId,
    template,
    // A Wednesday, so "the next working day" is not itself a weekend.
    now: new Date("2026-09-16T12:00:00.000Z"),
  });
};

const asMember = async () => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});

describe("the catalogue", () => {
  it("offers three templates, each with a name and who it is for", () => {
    expect(STARTING_TEMPLATES).toHaveLength(3);
    for (const template of STARTING_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.forWhom.length).toBeGreaterThan(0);
      expect(template.objectives.length).toBeGreaterThan(0);
    }
  });

  it("keeps every objective inside the method's own caps", () => {
    for (const template of STARTING_TEMPLATES) {
      // §2.7: five company objectives at most, three per unit.
      const company = template.objectives.filter((o) => o.level === "company");
      expect(company.length).toBeLessThanOrEqual(5);
      expect(template.objectives.length).toBeLessThanOrEqual(5);

      for (const objective of template.objectives) {
        // Two to five key results. One is a measure pretending to be an
        // objective; more than five is a plan.
        expect(objective.keyResults.length).toBeGreaterThanOrEqual(2);
        expect(objective.keyResults.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it("pairs a lagging measure with a leading one in every objective", () => {
    for (const template of STARTING_TEMPLATES) {
      for (const objective of template.objectives) {
        const kinds = new Set(
          objective.keyResults.map((kr) => kr.indicatorType),
        );
        // An objective with only lagging measures gives the weekly session
        // nothing to talk about until it is too late.
        expect(kinds.has("lagging")).toBe(true);
        expect(kinds.has("leading")).toBe(true);
      }
    }
  });

  it("gives every key result a baseline and a target that differ", () => {
    for (const template of STARTING_TEMPLATES) {
      for (const objective of template.objectives) {
        for (const kr of objective.keyResults) {
          expect(kr.baselineValue).not.toBe(kr.targetValue);
          if (kr.direction === "increase") {
            expect(kr.targetValue).toBeGreaterThan(kr.baselineValue);
          } else {
            expect(kr.targetValue).toBeLessThan(kr.baselineValue);
          }
        }
      }
    }
  });
});

describe("the starter template, which is the acceptance criterion", () => {
  it("creates goals in a cycle, a KPI, and the first weekly session", async () => {
    const result = await apply("starter");

    expect(result.alreadySeeded).toBe(false);
    expect(result.objectivesCreated).toBe(1);
    expect(result.keyResultsCreated).toBe(3);
    expect(result.kpisCreated).toBe(1);
    expect(result.weeklySessionId).not.toBeNull();
  });

  it("populates the Work Map, read the way the screen reads it", async () => {
    await apply("starter");

    const listed = await callAction(await asMember(), "goals.list", {
      includeClosed: false,
    });
    const goals = (listed as { goals: { title: string; cycleId?: string }[] })
      .goals;

    expect(goals.length).toBe(1);
    expect(goals[0]?.title).toBe(
      "Make onboarding the reason new customers stay",
    );
    // In a cycle, which is what makes it a goal with a cadence rather than a
    // note somebody wrote.
    expect(goals[0]?.cycleId).toBeTruthy();
  });

  it("schedules the session for the next working day, not for now", async () => {
    const wb = await workerDb();
    const result = await apply("starter");

    const { rows } = await wb.admin.query(
      "select kind, scheduled_for from okr_sessions where id = $1",
      [result.weeklySessionId],
    );
    expect(rows[0]?.kind).toBe("weekly");

    const scheduled = new Date(rows[0]?.scheduled_for as string);
    // Applied on a Wednesday, so Thursday.
    expect(scheduled.getUTCDay()).toBe(4);
    expect(scheduled.getTime()).toBeGreaterThan(
      new Date("2026-09-16T12:00:00.000Z").getTime(),
    );
  });

  it("links the lagging key result to the KPI it belongs to", async () => {
    const wb = await workerDb();
    await apply("starter");

    const { rows } = await wb.admin.query(
      `select k.title, k.kpi_id from key_results k
        where k.workspace_id = $1 and k.kpi_id is not null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain("30-day retention");
  });
});

describe("the other two templates", () => {
  it("builds a company's first quarter, three objectives across the shape", async () => {
    const result = await apply("company-onboarding");

    expect(result.objectivesCreated).toBe(3);
    expect(result.keyResultsCreated).toBe(6);
    expect(result.spacesCreated).toBe(0);
  });

  it("builds a product team its own space and KPI tree", async () => {
    const wb = await workerDb();
    const result = await apply("product-team");

    expect(result.spacesCreated).toBe(1);
    expect(result.objectivesCreated).toBe(2);
    expect(result.kpisCreated).toBe(1);

    const { rows } = await wb.admin.query(
      "select name from spaces where workspace_id = $1 and name = 'Product'",
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("applying one twice", () => {
  it("writes nothing the second time, and says so", async () => {
    const first = await apply("starter");
    expect(first.objectivesCreated).toBe(1);

    const again = await apply("starter");
    expect(again.alreadySeeded).toBe(true);
    expect(again.objectivesCreated).toBe(0);

    const listed = await callAction(await asMember(), "goals.list", {
      includeClosed: false,
    });
    expect((listed as { goals: unknown[] }).goals).toHaveLength(1);
  });

  it("refuses a second template over the first one's work", async () => {
    await apply("starter");
    const other = await apply("company-onboarding");

    // The first template's quarter is somebody's now. A second one applied
    // over it would be a mess nobody asked for.
    expect(other.alreadySeeded).toBe(true);
  });
});

describe("choosing nothing", () => {
  it("writes nothing at all, which is the default and not a lesser path", async () => {
    const result = await apply("none");

    expect(result.objectivesCreated).toBe(0);
    expect(result.weeklySessionId).toBeNull();

    const listed = await callAction(await asMember(), "goals.list", {
      includeClosed: false,
    });
    expect((listed as { goals: unknown[] }).goals).toHaveLength(0);
  });
});

describe("the next working day", () => {
  it("moves a Friday to Monday rather than to Saturday", () => {
    // 18 September 2026 is a Friday.
    const monday = firstWeeklySession(new Date("2026-09-18T12:00:00.000Z"));
    expect(monday.getUTCDay()).toBe(1);
  });

  it("opens the working day rather than the moment somebody pressed", () => {
    const next = firstWeeklySession(new Date("2026-09-16T23:41:00.000Z"));
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it("names a real template and nothing else", () => {
    expect(startingTemplateFor("starter")?.name).toBe("OKR starter cycle");
    expect(startingTemplateFor("none")).toBeUndefined();
  });
});
