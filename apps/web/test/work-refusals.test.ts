import { OperationError } from "@openokr/core";
import { CATALOGUES, translate } from "@openokr/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Initiatives, tasks and documents, refused under the field they are about
 * (guided-inputs §4.2, plan 0.7.0 U1b).
 *
 * The add forms are `ActionForm`s and take every field a refusal names. A
 * drag, a row's select, a tick and the document editor draw no field, so they
 * keep the sentence, and a schema's refusal no longer opens the error page.
 */

const callAction = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
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

const { createInitiativeAction, linkKeyResultAction, setStatusAction } =
  await import("../app/initiatives/actions.ts");
const { addChecklistItemAction, createTaskAction, moveTaskAction } =
  await import("../app/board/actions.ts");
const { createDocumentAction, updateDocumentAction } = await import(
  "../app/documents/actions.ts"
);

const en = (key: string) => translate(CATALOGUES.en, key);
const NONE = { error: null };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

const tooLong = (path: readonly (string | number)[], maximum: number) =>
  Object.assign(new Error("[]"), {
    name: "ZodError",
    issues: [
      {
        code: "too_big",
        origin: "string",
        maximum,
        path,
        message: `Too big: expected string to have <=${maximum} characters`,
      },
    ],
  });

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({ id: "new" });
});

describe("the add forms' own checks land on their field", () => {
  it("an initiative with no owner, under the owner", async () => {
    expect(
      await createInitiativeAction(
        NONE,
        form({ title: "Rebuild onboarding", spaceId: "s" }),
      ),
    ).toEqual({
      error: null,
      fields: {
        ownerId: en("initiatives.actions.initiativeNeedsASpaceAndOwner"),
      },
    });
  });

  it("a task with no title or no space, a checklist line with no words, and a document with no title", async () => {
    expect(await createTaskAction(NONE, form({ spaceId: "s" }))).toEqual({
      error: null,
      fields: { title: en("board.actions.taskNeedsATitle") },
    });
    expect(await createTaskAction(NONE, form({ title: "Call" }))).toEqual({
      error: null,
      fields: { spaceId: en("board.actions.taskLivesInASpace") },
    });
    expect(await addChecklistItemAction(NONE, form({ id: "t" }))).toEqual({
      error: null,
      fields: { title: en("board.actions.checklistLineNeedsWords") },
    });
    expect(
      await createDocumentAction(
        NONE,
        form({ subjectType: "goal", subjectId: "g" }),
      ),
    ).toEqual({
      error: null,
      fields: { title: en("documents.actions.documentNeedsATitle") },
    });
  });

  it("a link with no key result picked, under the picker", async () => {
    expect(await linkKeyResultAction(NONE, form({ id: "i" }))).toEqual({
      error: null,
      fields: { keyResultId: en("initiatives.actions.pickTheKeyResult") },
    });
  });
});

describe("a refusal from the action", () => {
  it("a title too long, under the title, which used to reach the error page", async () => {
    callAction.mockRejectedValue(tooLong(["title"], 500));
    const message = translate(CATALOGUES.en, "fields.tooLong", { max: 500 });
    expect(
      await createTaskAction(NONE, form({ title: "Call", spaceId: "s" })),
    ).toEqual({ error: null, fields: { title: message } });
    expect(
      await createDocumentAction(
        NONE,
        form({ subjectType: "goal", subjectId: "g", title: "Plan" }),
      ),
    ).toEqual({ error: null, fields: { title: message } });
  });

  it("the key result an initiative starts with, under the picker the form names it by", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "not_found",
        "No such key result.",
        undefined,
        "keyResultIds.0",
      ),
    );
    expect(
      await createInitiativeAction(
        NONE,
        form({
          title: "Rebuild onboarding",
          spaceId: "s",
          ownerId: "m",
          keyResultId: "k",
        }),
      ),
    ).toEqual({ error: null, fields: { keyResultId: "No such key result." } });
  });

  it("keeps the sentence for a drag, a row's select and the editor", async () => {
    callAction.mockRejectedValue(
      new OperationError("forbidden", "Not yours.", undefined, "status"),
    );
    expect(await moveTaskAction("t", "done", null)).toEqual({
      error: "Not yours.",
    });
    expect(await setStatusAction("i", "active")).toEqual({
      error: "Not yours.",
    });
    callAction.mockRejectedValue(tooLong(["body"], 100000));
    expect(await updateDocumentAction("d", "goal", "g", null)).toEqual({
      error: translate(CATALOGUES.en, "fields.tooLong", { max: 100000 }),
    });
  });
});
