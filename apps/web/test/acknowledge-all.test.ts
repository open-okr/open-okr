import { OperationError } from "@openokr/core";
import { CATALOGUES, translate } from "@openokr/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Acknowledge all" on the review inbox (OKRGoal UX review, H4): 241
 * acknowledgements, each a separate button, with no preview. Each row now
 * shows what its check-in says, and one press acknowledges every row listed.
 */

const callAction = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
    locale: "en",
  }),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
    memberships: [],
  }),
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({}) }));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { acknowledgeAll } = await import("../app/review/actions.ts");

const ids = [
  "66666666-6666-4666-8666-666666666661",
  "66666666-6666-4666-8666-666666666662",
  "66666666-6666-4666-8666-666666666663",
];

const form = (values: readonly string[]) => {
  const data = new FormData();
  for (const value of values) {
    data.append("checkInId", value);
  }
  return data;
};

beforeEach(() => {
  callAction.mockReset();
  revalidatePath.mockReset();
});

describe("acknowledging every listed check-in at once", () => {
  it("acknowledges each one through the reviewer's own action", async () => {
    callAction.mockResolvedValue({});
    const state = await acknowledgeAll({ error: null }, form(ids));
    expect(callAction).toHaveBeenCalledTimes(3);
    for (const id of ids) {
      expect(callAction).toHaveBeenCalledWith(
        expect.anything(),
        "goals.acknowledgeCheckIn",
        { id },
      );
    }
    expect(state).toEqual({ error: null, notice: "Acknowledged 3." });
    expect(revalidatePath).toHaveBeenCalledWith("/review");
  });

  it("keeps going past a refusal and says how many were refused", async () => {
    callAction
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new OperationError("forbidden", "Not yours."))
      .mockResolvedValueOnce({});
    const state = await acknowledgeAll({ error: null }, form(ids));
    expect(callAction).toHaveBeenCalledTimes(3);
    expect(state.error).toBe("Acknowledged 2. 1 could not be: Not yours.");
  });
});
