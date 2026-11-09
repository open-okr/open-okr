import { OperationError } from "@openokr/core";
import { CATALOGUES, translate } from "@openokr/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sentenceUnlessDrawn } from "../lib/drawn-refusal.ts";

/**
 * Goals and key results, refused under the field they are about
 * (guided-inputs §4.2, plan 0.7.0 U1b).
 *
 * The goal page's forms are `ActionForm`s and take every field a refusal
 * names. The key result row and the editor's adds draw their own fields, and
 * the adds keep their sentence too, because the OKR table's and the diagram's
 * add rows show only that.
 */

const callAction = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/drafter", () => ({ drafterFor: async () => null }));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
  }),
}));

const { applyRewrite, closeGoal, editGoal, updateKeyResult } = await import(
  "../app/goals/[id]/actions.ts"
);
const { moveGoalToCycle, linkKeyResultKpi } = await import(
  "../app/goals/[id]/write-actions.ts"
);
const { addCycle, addObjective } = await import(
  "../app/goals/editor-actions.ts"
);
const { setStandaloneReason } = await import(
  "../app/goals/alignment-actions.ts"
);
const { recordFromMap } = await import("../app/work-map-actions.ts");

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

const tooLong = (path: readonly (string | number)[], maximum: number) =>
  zodError([
    {
      code: "too_big",
      origin: "string",
      maximum,
      path,
      message: `Too big: expected string to have <=${maximum} characters`,
    },
  ]);

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({ id: "new", checkIns: [] });
});

describe("the goal page's forms", () => {
  it("a title left empty, under the title", async () => {
    expect(await editGoal(NONE, form({ id: "g", title: " " }))).toEqual({
      error: null,
      fields: { title: en("goals.detail.actions.objectiveNeedsATitle") },
    });
  });

  it("a close with no retrospective, under the retrospective", async () => {
    expect(await closeGoal(NONE, form({ id: "g" }))).toEqual({
      error: null,
      fields: {
        retrospective: en("goals.detail.actions.closingNeedsARetrospective"),
      },
    });
  });

  it("a retrospective the action refuses, under the field the form calls it", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "forbidden",
        "Write what happened.",
        undefined,
        "retrospectiveBody",
      ),
    );
    const written = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "We" }] }],
    });
    expect(
      await closeGoal(NONE, form({ id: "g", retrospective: written })),
    ).toEqual({
      error: null,
      fields: { retrospective: "Write what happened." },
    });
  });

  it("a title too long, which used to reach the error page", async () => {
    callAction.mockRejectedValue(tooLong(["title"], 500));
    expect(await editGoal(NONE, form({ id: "g", title: "Grow" }))).toEqual({
      error: null,
      fields: {
        title: translate(CATALOGUES.en, "fields.tooLong", { max: 500 }),
      },
    });
  });
});

describe("a key result's value and confidence", () => {
  it("names the status or the line it is missing", async () => {
    expect(
      await updateKeyResult({
        goalId: "g",
        keyResultId: "k",
        confidence: 0.6,
        status: null,
      }),
    ).toEqual({
      error: null,
      fields: { status: en("goals.detail.actions.chooseAStatus") },
    });
    expect(
      await updateKeyResult({
        goalId: "g",
        keyResultId: "k",
        confidence: 0.6,
        status: "caution",
        note: " ",
      }),
    ).toEqual({
      error: null,
      fields: { note: en("goals.detail.actions.confidenceNeedsALine") },
    });
  });

  it("puts the check-in's refusals under the row's own fields", async () => {
    callAction.mockResolvedValueOnce({ checkIns: [] }).mockRejectedValueOnce(
      zodError([
        {
          code: "custom",
          path: ["values", 0, "value"],
          message: "Not a number this measure takes.",
        },
      ]),
    );
    expect(
      await updateKeyResult({
        goalId: "g",
        keyResultId: "k",
        value: 12,
        confidence: 0.6,
        status: "caution",
        note: "Slower than hoped",
      }),
    ).toEqual({
      error: null,
      fields: { value: "Not a number this measure takes." },
    });
  });

  it("says a refusal about a field the row does not draw as its sentence", async () => {
    callAction.mockRejectedValue(
      new OperationError("forbidden", "This goal is closed.", undefined, "id"),
    );
    expect(
      await updateKeyResult({ goalId: "g", keyResultId: "k", value: 3 }),
    ).toEqual({ error: "This goal is closed." });
  });

  it("the coach strip's rewrite keeps the sentence, since it draws no field", async () => {
    callAction.mockRejectedValue(tooLong(["title"], 500));
    expect(await applyRewrite("g", "k", "A long title")).toEqual({
      error: translate(CATALOGUES.en, "fields.tooLong", { max: 500 }),
    });
  });

  it("the Work Map's value box, under the value", async () => {
    expect(
      await recordFromMap(NONE, form({ goalId: "g", keyResultId: "k" })),
    ).toEqual({
      error: null,
      fields: { value: en("quickCheckIn.typeAValueFirst") },
    });
  });
});

describe("the editor's adds", () => {
  it("keep the sentence beside the fields, for the add rows that show only it", async () => {
    callAction.mockRejectedValue(tooLong(["title"], 500));
    const message = translate(CATALOGUES.en, "fields.tooLong", { max: 500 });
    expect(
      await addObjective({ cycleId: "c", level: "team", title: "Grow" }),
    ).toEqual({ error: message, fields: { title: message }, id: null });
  });

  it("the cycle dialog draws all three, so a refused date stands under it alone", async () => {
    callAction.mockRejectedValue(
      new OperationError("conflict", "That period exists.", undefined, "on"),
    );
    expect(await addCycle({ on: "2027-04-01", cadence: "quarterly" })).toEqual({
      error: null,
      fields: { on: "That period exists." },
      id: null,
    });
  });

  it("a form that draws the refused field says no sentence over it", () => {
    const refused = {
      error: "Say why it starts now.",
      fields: { reason: "Say why it starts now." },
    };
    expect(sentenceUnlessDrawn(refused, ["title", "reason"])).toBeNull();
    expect(sentenceUnlessDrawn(refused, ["title"])).toBe(
      "Say why it starts now.",
    );
    expect(sentenceUnlessDrawn({ error: "Closed." }, ["title"])).toBe(
      "Closed.",
    );
  });
});

describe("the goal page's moves and links", () => {
  it("puts a refused cycle or KPI under its picker", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "conflict",
        "That cycle is closed.",
        undefined,
        "cycleId",
      ),
    );
    expect(await moveGoalToCycle({ id: "g", cycleId: "c" })).toEqual({
      error: null,
      fields: { cycleId: "That cycle is closed." },
    });
    callAction.mockRejectedValue(
      new OperationError("not_found", "No such KPI.", undefined, "kpiId"),
    );
    expect(await linkKeyResultKpi({ id: "k", kpiId: "x" })).toEqual({
      error: null,
      fields: { kpiId: "No such KPI." },
    });
  });
});

describe("the alignment clicks", () => {
  it("say a schema's refusal as the sentence, instead of the error page", async () => {
    callAction.mockRejectedValue(tooLong(["standaloneReason"], 1000));
    expect(await setStandaloneReason("g", "Because")).toEqual({
      error: translate(CATALOGUES.en, "fields.tooLong", { max: 1000 }),
    });
  });
});
