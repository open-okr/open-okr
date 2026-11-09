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
 * The cycle workspace's refusals, under the field they are about
 * (guided-inputs §4.2, plan 0.7.0 U1b).
 *
 * Every cycle write used to answer with one sentence over the whole form, and
 * a schema's refusal went to the error page. Now each action hands back the
 * fields a refusal names, its own early checks included, and `ActionForm`
 * gives them to the fields the page drew inside it.
 */

const callAction = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/pool", () => ({ getPool: () => ({ pool: true }) }));
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

const { addIssue, addPriority } = await import("../app/cycle/actions.ts");
const { addKeyResult, createGoal, recordValue } = await import(
  "../app/cycle/goal-actions.ts"
);
const { saveCapacityCuts, saveCycleSetup, saveRevalidation } = await import(
  "../app/cycle/setup-actions.ts"
);
const { sendForward, setFrame } = await import("../app/cycle/frame-actions.ts");
const { archiveCycle, createCycle, updateCycleDates } = await import(
  "../app/cycle/admin-actions.ts"
);
const { ActionForm } = await import("../app/cycle/action-form.tsx");

const en = (key: string) => translate(CATALOGUES.en, key);
const NONE = { error: null };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

/** A schema refusal by shape, as one arrives from core's copy of zod. */
const zodError = (issues: readonly Record<string, unknown>[]) =>
  Object.assign(new Error(JSON.stringify(issues)), {
    name: "ZodError",
    issues,
  });

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({ id: "cycle-2" });
});

describe("a cycle write's own checks land on their field", () => {
  it("an issue or a priority with no sentence, under the sentence", async () => {
    expect(await addIssue(NONE, form({ cycleId: "c", text: " " }))).toEqual({
      error: null,
      fields: { text: en("cycle.actions.issueNeedsASentence") },
    });
    expect(await addPriority(NONE, form({ cycleId: "c", text: "" }))).toEqual({
      error: null,
      fields: { text: en("cycle.actions.priorityNeedsASentence") },
    });
    expect(callAction).not.toHaveBeenCalled();
  });

  it("an objective or a quarterly objective with no title, under the title", async () => {
    expect(await createGoal(NONE, form({ cycleId: "c" }))).toEqual({
      error: null,
      fields: { title: en("cycle.actions.objectiveNeedsASentence") },
    });
    expect(await sendForward(NONE, form({ goalId: "g" }))).toEqual({
      error: null,
      fields: { title: en("cycle.actions.quarterlyObjectiveNeedsATitle") },
    });
  });

  it("a key result missing its baseline, under the baseline only", async () => {
    expect(
      await addKeyResult(
        NONE,
        form({ goalId: "g", title: "Churn", targetValue: "4" }),
      ),
    ).toEqual({
      error: null,
      fields: {
        baselineValue: en("cycle.actions.keyResultNeedsBaselineAndTarget"),
      },
    });
  });

  it("a value that is not a number, under the value", async () => {
    expect(await recordValue(NONE, form({ id: "k", value: "" }))).toEqual({
      error: null,
      fields: { value: en("cycle.actions.valueHasToBeANumber") },
    });
  });

  it("a capacity note left empty or unreadable, under the note", async () => {
    expect(await saveCapacityCuts(NONE, form({ cycleId: "c" }))).toEqual({
      error: null,
      fields: { cuts: en("cycle.cuts.writeSomething") },
    });
    expect(
      await saveRevalidation(NONE, form({ cycleId: "c", focusNote: "{" })),
    ).toEqual({
      error: null,
      fields: { focusNote: en("fields.richTextUnreadable") },
    });
    expect(
      await setFrame(NONE, form({ yearLabel: "2027", vision: "nope" })),
    ).toEqual({
      error: null,
      fields: { vision: en("fields.richTextUnreadable") },
    });
  });
});

describe("a refusal from the action lands on the field it names", () => {
  it("an operation's refusal about one field", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "conflict",
        "Too many objectives.",
        undefined,
        "title",
      ),
    );
    expect(
      await createGoal(NONE, form({ cycleId: "c", title: "Grow" })),
    ).toEqual({ error: null, fields: { title: "Too many objectives." } });
  });

  it("a schema's refusal, which used to reach the error page", async () => {
    callAction.mockRejectedValue(
      zodError([
        {
          code: "too_big",
          origin: "string",
          maximum: 500,
          path: ["text"],
          message: "Too big: expected string to have <=500 characters",
        },
      ]),
    );
    expect(await addIssue(NONE, form({ cycleId: "c", text: "Long" }))).toEqual({
      error: null,
      fields: {
        text: translate(CATALOGUES.en, "fields.tooLong", { max: 500 }),
      },
    });
  });

  it("a session date, under the session's own date field", async () => {
    callAction.mockRejectedValue(
      zodError([
        {
          code: "custom",
          path: ["sessionDates", 0, "on"],
          message: "Not a day.",
        },
      ]),
    );
    // Only the third session has a date, so it is the first in the list sent.
    expect(
      await saveCycleSetup(
        NONE,
        form({ cycleId: "c", "session-draft": "2027-13-01" }),
      ),
    ).toEqual({ error: null, fields: { "session-draft": "Not a day." } });
  });

  it("keeps the sentence for a refusal about the whole write", async () => {
    callAction.mockRejectedValue(
      new OperationError("forbidden", "A closed cycle does not change."),
    );
    expect(await addIssue(NONE, form({ cycleId: "c", text: "Churn" }))).toEqual(
      {
        error: "A closed cycle does not change.",
      },
    );
  });

  it("sends a failure on to the error page", async () => {
    callAction.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(
      addIssue(NONE, form({ cycleId: "c", text: "Churn" })),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

describe("the cycle card's dates", () => {
  it("puts a refused date under the date it draws, and anything else in the sentence", async () => {
    callAction.mockRejectedValue(
      new OperationError("conflict", "That quarter exists.", undefined, "on"),
    );
    expect(await createCycle({ on: "2027-04-01", mode: "quarterly" })).toEqual({
      error: null,
      fields: { on: "That quarter exists." },
    });
    callAction.mockRejectedValue(
      new OperationError(
        "conflict",
        "After the cycle ends.",
        undefined,
        "publicationDeadline",
      ),
    );
    expect(
      await updateCycleDates({ id: "c", publicationDeadline: "2028-01-01" }),
    ).toEqual({
      error: null,
      fields: { publicationDeadline: "After the cycle ends." },
    });
    callAction.mockRejectedValue(
      new OperationError("forbidden", "Still open.", undefined, "id"),
    );
    expect(await archiveCycle({ id: "c" })).toEqual({ error: "Still open." });
  });
});

describe("ActionForm", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows a refused field under that field, and no sentence over the form", async () => {
    const action = async () => ({
      error: null,
      fields: { text: "Say what the issue is." },
    });
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <ActionForm action={action}>
            <TextInput label="Issue" name="text" />
            <button type="submit">Add</button>
          </ActionForm>
        </TranslationsProvider>,
      );
    });
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    const alerts = [...container.querySelectorAll('[role="alert"]')];
    expect(alerts.map((one) => one.textContent)).toEqual([
      "Say what the issue is.",
    ]);
    const input =
      container.querySelector<HTMLInputElement>('input[name="text"]');
    expect(input?.getAttribute("aria-invalid")).toBe("true");
  });
});
