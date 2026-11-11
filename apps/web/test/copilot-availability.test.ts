import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * A failed availability read is the copilot unavailable, never the page
 * (plan 0.8.1 CP8, review F14).
 *
 * Acceptance criterion: given the availability read throws, when any page
 * loads, then the page renders, and the copilot says it cannot answer right
 * now. The shell awaits this action on every page, so it not throwing is what
 * lets the page render; the panel draws `reason: null` as "cannot answer right
 * now".
 */

const core = vi.hoisted(() => ({
  callAction: vi.fn(),
  hasPlanScreen: vi.fn(async () => false),
  navigationFor: vi.fn(() => [] as { href: string }[]),
  reportError: vi.fn(),
}));
const drafter = vi.hoisted(() => ({ resolveDrafterFor: vi.fn() }));

vi.mock("@openokr/core", () => core);
vi.mock("../lib/drafter", () => drafter);
vi.mock("../lib/auth", () => ({ getPool: () => ({}) }));
vi.mock("../lib/access", () => ({
  resolveAccessLevelFor: vi.fn(async () => 50),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: vi.fn(async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
  })),
}));

const { copilotAvailabilityAction } = await import("../app/copilot/actions.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the copilot's availability read", () => {
  test("answers unavailable when resolving the provider throws", async () => {
    // What the review saw live: an AI key sealed by a root key this process
    // does not hold.
    drafter.resolveDrafterFor.mockRejectedValue(
      new Error("KeyRingError: no key for this envelope"),
    );
    const availability = await copilotAvailabilityAction();
    expect(availability).toMatchObject({
      available: false,
      providerConfigured: true,
      reason: null,
      fixes: [],
    });
    // Reported, so an operator finds out without a person telling them.
    expect(core.reportError).toHaveBeenCalledTimes(1);
  });

  test("answers unavailable when the read itself throws", async () => {
    drafter.resolveDrafterFor.mockResolvedValue({ off: "no_provider" });
    core.callAction.mockRejectedValue(new Error("connection reset"));
    const availability = await copilotAvailabilityAction();
    expect(availability.available).toBe(false);
    expect(availability.reason).toBeNull();
  });

  test("links an administrator to the AI page with no provider", async () => {
    drafter.resolveDrafterFor.mockResolvedValue({ off: "no_provider" });
    core.callAction.mockImplementation(async (_context, name: string) =>
      name === "copilot.availability"
        ? {
            available: false,
            providerConfigured: false,
            reason: "No AI provider is configured.",
            searchAvailable: true,
            streaming: false,
            resetsAt: null,
          }
        : [],
    );
    core.navigationFor.mockReturnValue([{ href: "/admin/ai" }]);
    const availability = await copilotAvailabilityAction();
    expect(availability.fixes).toEqual(["aiSettings"]);
  });
});
