// @vitest-environment jsdom
import { OperationError } from "@openokr/core";
import {
  CATALOGUES,
  TextInput,
  TranslationsProvider,
  translate,
} from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KPIs, refused under the field they are about (guided-inputs §4.2, plan
 * 0.7.0 U1b): the New KPI and New category panels, the KPI page's rule, the
 * driver trees and the recovery board. A grid cell, the formula builder and
 * Launch recovery draw no field, so they keep the sentence.
 */

const callAction = vi.fn();
const replace = vi.fn();
let search = "new=kpi";

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/kpis",
  useRouter: () => ({ replace, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/assists", () => ({ assistContext: async () => ({}) }));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1" },
  }),
}));

const { addCategory, addKpi, addSuggestedKpiAction, recordCell } = await import(
  "../app/kpis/actions.ts"
);
const { setFormula } = await import("../app/kpis/[id]/actions.ts");
const { addDriver, addTree, fileIntoTree } = await import(
  "../app/kpis/trees/actions.ts"
);
const { answerKpiWithKeyResult, fixKpiNow, launchRecovery } = await import(
  "../app/kpis/recovery/actions.ts"
);
const { KpiPanel } = await import("../app/kpis/kpi-panel.tsx");

const en = (key: string) => translate(CATALOGUES.en, key);
const NONE = { error: null };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

const zodError = (issues: readonly Record<string, unknown>[]) =>
  Object.assign(new Error(JSON.stringify(issues)), {
    name: "ZodError",
    issues,
  });

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({ id: "new" });
});

describe("the KPI forms' own checks land on their field", () => {
  it("a KPI, a category, a tree or a driver with no name, under the name", async () => {
    expect(await addKpi(NONE, form({}))).toEqual({
      error: null,
      fields: { title: en("kpis.actions.kpiNeedsATitle") },
    });
    expect(await addCategory(NONE, form({}))).toEqual({
      error: null,
      fields: { name: en("kpis.actions.categoryNeedsAName") },
    });
    expect(await addTree(NONE, form({}))).toEqual({
      error: null,
      fields: { name: en("kpis.trees.actions.treeNeedsAName") },
    });
    expect(await addDriver(NONE, form({ parentKpiId: "p" }))).toEqual({
      error: null,
      fields: { title: en("kpis.trees.actions.driverNeedsATitleAndParent") },
    });
    expect(await fileIntoTree(NONE, form({ treeId: "t" }))).toEqual({
      error: null,
      fields: { kpiId: en("kpis.trees.actions.pickAKpiToFile") },
    });
  });

  it("a fix with no date, under the date", async () => {
    expect(
      await fixKpiNow(
        NONE,
        form({ kpiId: "k", title: "Call them", spaceId: "s", ownerId: "m" }),
      ),
    ).toEqual({
      error: null,
      fields: { dueOn: en("kpis.recovery.actions.fixNeedsAnOwnerAndADate") },
    });
  });

  it("a key result for the KPI whose target is not a number, under the target", async () => {
    expect(
      await answerKpiWithKeyResult(
        NONE,
        form({
          kpiId: "k",
          goalId: "g",
          title: "Churn",
          baseline: "4",
          target: "lots",
        }),
      ),
    ).toEqual({
      error: null,
      fields: { target: en("kpis.recovery.actions.keyResultNeedsNumbers") },
    });
  });
});

describe("a refusal from the action", () => {
  it("lands under the recovery form's own name for the field", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "forbidden",
        "The target is where it starts.",
        undefined,
        "targetValue",
      ),
    );
    expect(
      await answerKpiWithKeyResult(
        NONE,
        form({
          kpiId: "k",
          goalId: "g",
          title: "Churn",
          baseline: "4",
          target: "4",
        }),
      ),
    ).toEqual({
      error: null,
      fields: { target: "The target is where it starts." },
    });
  });

  it("a schema's refusal on the panel, which used to reach the error page", async () => {
    callAction.mockRejectedValue(
      zodError([
        {
          code: "too_big",
          origin: "string",
          maximum: 500,
          path: ["title"],
          message: "Too big: expected string to have <=500 characters",
        },
      ]),
    );
    expect(await addKpi(NONE, form({ title: "Revenue" }))).toEqual({
      error: null,
      fields: {
        title: translate(CATALOGUES.en, "fields.tooLong", { max: 500 }),
      },
    });
  });

  it("the suggestion card hears about its own fields by name, and the formula as its sentence", async () => {
    const kept = {
      title: "Weekly active teams",
      unit: "",
      frequency: "weekly" as const,
      direction: "higher_better" as const,
      tier: "outcome" as const,
      targetDefault: null,
      healthyPct: 90,
      watchPct: 300,
      formula: null,
    };
    callAction.mockRejectedValue(
      new OperationError("forbidden", "At most 200.", undefined, "watchPct"),
    );
    expect(await addSuggestedKpiAction(kept)).toEqual({
      error: null,
      fields: { watchPct: "At most 200." },
    });
    callAction.mockRejectedValue(
      new OperationError(
        "forbidden",
        "That formula loops.",
        undefined,
        "formula",
      ),
    );
    expect(await addSuggestedKpiAction(kept)).toEqual({
      error: "That formula loops.",
    });
  });

  it("a grid cell, the formula builder and Launch recovery keep the sentence", async () => {
    callAction.mockRejectedValue(
      new OperationError("forbidden", "Not yours.", undefined, "actualValue"),
    );
    expect(await recordCell("k", "2027-01-01", 3)).toEqual({
      error: "Not yours.",
    });
    expect(await setFormula("k", "add", ["A", "B"], "2027-01-01")).toEqual({
      error: "Not yours.",
    });
    callAction.mockResolvedValueOnce({ id: "cycle" });
    expect(await launchRecovery("k")).toEqual({ error: "Not yours." });
  });
});

describe("the KPI panel", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    replace.mockReset();
    search = "new=kpi";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("stays open on a refused field and shows it under that field", async () => {
    const action = async () => ({
      error: null,
      fields: { title: "Name what is being measured." },
    });
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <KpiPanel
            which="kpi"
            title="New KPI"
            submitLabel="Add"
            action={action}
          >
            <TextInput label="What is being measured" name="title" />
          </KpiPanel>
        </TranslationsProvider>,
      );
    });
    const panel = document.querySelector<HTMLFormElement>("#kpi-kpi-form");
    await act(async () => {
      panel?.requestSubmit();
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[name="title"]',
    );
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    const alerts = [...document.querySelectorAll('[role="alert"]')];
    expect(alerts.map((one) => one.textContent)).toEqual([
      "Name what is being measured.",
    ]);
    expect(replace).not.toHaveBeenCalled();
  });
});
