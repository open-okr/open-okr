import { CATALOGUES, translate } from "@openokr/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Raising a blocker from the check-in page (OKRGoal UX review, H11).
 *
 * `blockers.raise` let an owner raise one outside a session, and the only
 * screen that could raise a blocker was the session room. An owner checking in
 * on Wednesday with something in the way had to wait for the meeting.
 */

const callAction = vi.fn();
const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
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
    memberships: [],
  }),
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({}) }));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { raiseBlockerFromCheckIn } = await import("../app/check-in/actions.ts");

const KEY_RESULT = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

beforeEach(() => {
  callAction.mockReset();
  revalidatePath.mockReset();
});

describe("raising a blocker from a check-in", () => {
  it("raises it through blockers.raise, with no session", async () => {
    callAction.mockResolvedValue({ id: "b", dueAt: "2026-11-09" });
    const state = await raiseBlockerFromCheckIn(
      { error: null },
      form({
        keyResultId: KEY_RESULT,
        type: "dependency",
        ownerId: OWNER,
        nextAction: "Ask finance for the budget line by Friday",
      }),
    );
    expect(state.error).toBeNull();
    expect(callAction).toHaveBeenCalledWith(
      expect.anything(),
      "blockers.raise",
      {
        keyResultId: KEY_RESULT,
        type: "dependency",
        ownerId: OWNER,
        nextAction: "Ask finance for the budget line by Friday",
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/check-in");
  });

  it("names the empty field instead of sending it", async () => {
    const state = await raiseBlockerFromCheckIn(
      { error: null },
      form({ keyResultId: KEY_RESULT, type: "not-a-type", ownerId: OWNER }),
    );
    expect(state.error).toBe(
      translate(CATALOGUES.en, "session.detail.actions.chooseTheBlockerKind"),
    );
    expect(callAction).not.toHaveBeenCalled();
  });
});
