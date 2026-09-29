import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withMessages } from "./screen-text.ts";

/**
 * An agent proposal is decided on the review screen (S-02, completeness
 * review M-08).
 *
 * The row linked to `/admin/agents`, which the admin layout refuses to anybody
 * below `full`, so an ordinary member was told they owed a decision and had
 * nowhere to make it. Who may decide, and what applying does, are proved
 * against a real database in `packages/core/test/proposal-decisions.test.ts`.
 * What is checked here is that the screen offers the decision on the row, calls
 * the member's actions rather than the administrator's, and carries the anchor
 * the inbox's own link points at.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const page = at("../app/review/page.tsx");
const decision = at("../app/review/proposal-decision.tsx");
const actions = at("../app/review/actions.ts");
const inbox = at("../../../packages/core/src/actions/review.ts");

describe("an agent proposal on the review screen", () => {
  test("is decided on its row, with its preview and both answers", () => {
    expect(page).toContain("<ProposalDecision");
    expect(decision).toContain("action={decideProposal}");
    expect(decision).toContain('name="proposalId"');
    expect(decision).toContain('value="apply"');
    expect(decision).toContain('value="dismiss"');
    // The preview is rendered before the buttons, because a person confirms
    // a change they can see.
    expect(decision.indexOf("proposal.preview.map")).toBeLessThan(
      decision.indexOf("action={decideProposal}"),
    );
    const said = withMessages(decision);
    expect(said).toContain("Apply");
    expect(said).toContain("Dismiss");
    expect(said).toContain("Drafted by AI");
  });

  test("calls the member's decision, never the administrator's queue", () => {
    expect(actions).toContain('"proposals.apply"');
    expect(actions).toContain('"proposals.dismiss"');
    expect(actions).not.toContain("proposals.bulkApply");
    expect(actions).not.toContain("proposals.bulkDismiss");
  });

  test("carries the anchor the inbox links to, and links nowhere admin-only", () => {
    // The core builds `/review#proposal-<id>`; the card is what that lands on.
    // Patterns rather than strings, because the source being matched is a
    // template literal and a string holding one reads as a mistake.
    expect(inbox).toMatch(/href: `\/review#proposal-\$\{row\.id\}`/);
    expect(page).toMatch(/id=\{[^}]*`proposal-\$\{obligation\.proposal\.id\}`/);
    for (const source of [page, decision, actions, inbox]) {
      expect(source).not.toContain('"/admin/agents"');
    }
  });
});

/**
 * What the form's server action does with each button.
 *
 * Mocked at the edges, the way `auth-route.test.ts` is: the question is which
 * action a press reaches and what a refusal turns into, not the actions
 * themselves, which the core suite runs against a real database. `doMock`
 * rather than `mock`, so the real core this file already loaded for the
 * catalogue is left alone.
 */
describe("the review screen's decision", () => {
  const callAction = vi.fn();
  const revalidatePath = vi.fn();
  class OperationError extends Error {}

  beforeEach(() => {
    vi.resetModules();
    callAction.mockReset().mockResolvedValue({});
    revalidatePath.mockReset();
    vi.doMock("@openokr/core", () => ({ callAction, OperationError }));
    vi.doMock("next/cache", () => ({ revalidatePath }));
    vi.doMock("../lib/auth", () => ({ getPool: () => "pool" }));
    vi.doMock("../lib/workspace", () => ({
      requireWorkspace: async () => ({
        session: { user: { id: "user-1" } },
        workspace: { workspaceId: "workspace-1" },
      }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("@openokr/core");
    vi.doUnmock("next/cache");
    vi.doUnmock("../lib/auth");
    vi.doUnmock("../lib/workspace");
    vi.resetModules();
  });

  const press = async (fields: Record<string, string>) => {
    const { decideProposal } = await import("../app/review/actions.ts");
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      form.set(name, value);
    }
    return decideProposal({ error: null }, form);
  };

  test("Apply reaches the member's apply, as them", async () => {
    const state = await press({ proposalId: "p-1", decision: "apply" });
    expect(state).toEqual({ error: null });
    expect(callAction).toHaveBeenCalledWith(
      {
        pool: "pool",
        workspaceId: "workspace-1",
        actor: { kind: "human", userId: "user-1" },
      },
      "proposals.apply",
      { id: "p-1" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/review");
  });

  test("Dismiss reaches the member's dismiss", async () => {
    await press({ proposalId: "p-1", decision: "dismiss" });
    expect(callAction).toHaveBeenCalledTimes(1);
    expect(callAction.mock.calls[0]?.[1]).toBe("proposals.dismiss");
  });

  test("a post naming neither answer is refused, never read as an apply", async () => {
    await expect(press({ proposalId: "p-1" })).rejects.toThrow(/neither/);
    await expect(
      press({ proposalId: "p-1", decision: "approve" }),
    ).rejects.toThrow(/neither/);
    expect(callAction).not.toHaveBeenCalled();
  });

  test("a refusal is shown on the row rather than thrown", async () => {
    callAction.mockRejectedValue(
      new OperationError("That proposal has already been decided."),
    );
    const state = await press({ proposalId: "p-1", decision: "apply" });
    expect(state).toEqual({ error: "That proposal has already been decided." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
