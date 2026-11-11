import { CATALOGUES, translate } from "@openokr/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving an input-pack note (UIUX-PLAN S-06).
 *
 * A note written into an empty item marks it gathered, because writing where
 * an item is, or who is bringing it, is how most people record that they have
 * it. Owners read a saved note beside a red Missing chip as a fault (11
 * November 2026). After that first note the box is the only thing that
 * changes the status: a note edited later, or one saying the item is still
 * missing, leaves it as it is.
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

const { savePackNote } = await import("../app/cycle/actions.ts");

const NONE = { error: null };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

/** What the one write was asked to store. */
async function saved(fields: Record<string, string>) {
  await savePackNote(
    NONE,
    form({ cycleId: "cycle-1", itemKey: "4", ...fields }),
  );
  expect(callAction).toHaveBeenCalledTimes(1);
  const [, name, input] = callAction.mock.calls[0] ?? [];
  expect(name).toBe("workflow.setPackItem");
  return input as { gathered: boolean; note: string | null };
}

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({ itemKey: 4, gathered: true });
});

describe("saving an input-pack note", () => {
  it("marks a missing item gathered when its first note is saved", async () => {
    const input = await saved({
      gathered: "false",
      hadNote: "false",
      note: "Priya brings the churn export",
    });
    expect(input).toMatchObject({
      gathered: true,
      note: "Priya brings the churn export",
    });
  });

  it("leaves a missing item missing when a note it already had is edited", async () => {
    // The person unticked it after the first note, so the box decides now.
    const input = await saved({
      gathered: "false",
      hadNote: "true",
      note: "Still waiting on finance",
    });
    expect(input).toMatchObject({
      gathered: false,
      note: "Still waiting on finance",
    });
  });

  it("keeps a gathered item gathered, with or without a note", async () => {
    expect(
      await saved({ gathered: "true", hadNote: "false", note: "In the drive" }),
    ).toMatchObject({ gathered: true, note: "In the drive" });
    callAction.mockClear();
    expect(
      await saved({ gathered: "true", hadNote: "true", note: "" }),
    ).toMatchObject({ gathered: true, note: null });
  });

  it("does not gather an item when an empty field is saved empty", async () => {
    const input = await saved({
      gathered: "false",
      hadNote: "false",
      note: "   ",
    });
    expect(input).toMatchObject({ gathered: false, note: null });
  });

  it("does not gather an item from a form that does not say it was empty", async () => {
    // A page drawn before this change posts no `hadNote`. Gathering on a guess
    // would tick an item whose note was only being corrected.
    const input = await saved({ gathered: "false", note: "Moved to Q3 deck" });
    expect(input).toMatchObject({ gathered: false, note: "Moved to Q3 deck" });
  });
});
