import { CATALOGUES, translate } from "@openokr/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recording a value from the Work Map's side panel (S-01).
 *
 * **An empty box recorded 0.** The action read the box with `Number()`, and
 * `Number("")` is 0, which is finite, so pressing Save on a cleared box wrote
 * a real value of 0 into the key result's history and moved its progress.
 */

class OperationError extends Error {}

const callAction = vi.fn();

vi.mock("@openokr/core", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
  OperationError,
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

const { recordFromMap } = await import("../app/work-map-actions.ts");

const KEY_RESULT = "11111111-1111-4111-8111-111111111111";

function submitted(value: string): FormData {
  const form = new FormData();
  form.set("goalId", "22222222-2222-4222-8222-222222222222");
  form.set("keyResultId", KEY_RESULT);
  form.set("value", value);
  return form;
}

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({});
});

describe("a value recorded from the Work Map", () => {
  it("records what was typed", async () => {
    const state = await recordFromMap({ error: null }, submitted("12.5"));

    expect(state.error).toBeNull();
    expect(callAction).toHaveBeenCalledWith(
      expect.anything(),
      "goals.recordValue",
      { id: KEY_RESULT, value: 12.5 },
    );
  });

  for (const [what, value] of [
    ["an empty box", ""],
    ["a box of spaces", "   "],
  ] as const) {
    it(`records nothing from ${what}, and says a value is needed`, async () => {
      const state = await recordFromMap({ error: null }, submitted(value));

      expect(callAction).not.toHaveBeenCalled();
      expect(state.error).toBe(
        translate(CATALOGUES.en, "quickCheckIn.typeAValueFirst"),
      );
    });
  }

  it("records nothing from text that is not a number", async () => {
    const state = await recordFromMap({ error: null }, submitted("about ten"));

    expect(callAction).not.toHaveBeenCalled();
    expect(state.error).toBe(
      translate(CATALOGUES.en, "cycle.actions.valueHasToBeANumber"),
    );
  });
});
