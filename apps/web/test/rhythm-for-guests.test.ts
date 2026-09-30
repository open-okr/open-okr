import { OperationError } from "@openokr/core";
import { canonThresholds, resolveTerminology } from "@openokr/method";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * The rhythm read every screen shares, as a guest meets it (completeness
 * review L-23).
 *
 * A guest holds nothing on the workspace itself, so `rhythm.read` answers
 * not-found. Before this, the goals on a guest's own space page failed to draw
 * because the progress ceiling and the Work Map's row chips both asked for it.
 */

const callAction = vi.fn();

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  // React's per-request memo has no request here; each call reads afresh.
  cache: <T>(fn: T) => fn,
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
    memberships: [],
  }),
}));
vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { readRhythmForRequest } = await import("../lib/rhythm");

beforeEach(() => {
  callAction.mockReset();
});

test("a member reads the workspace's own thresholds and terms", async () => {
  const thresholds = {
    ...canonThresholds(),
    "scoring.progressCeilingPct": 150,
  };
  callAction.mockResolvedValue({ thresholds, terminology: { x: 1 } });

  const read = await readRhythmForRequest();

  expect(read.thresholds).toBe(thresholds);
  expect(read.terminology).toEqual({ x: 1 });
});

test("a guest, refused the workspace read, gets the canon's instead of an error", async () => {
  callAction.mockRejectedValue(
    new OperationError(
      "not_found",
      "No such workspace, or you do not have access to it.",
    ),
  );

  const read = await readRhythmForRequest();

  expect(read.thresholds).toEqual(canonThresholds());
  expect(read.terminology).toEqual(resolveTerminology());
});

test("any other failure is still a failure", async () => {
  callAction.mockRejectedValue(new Error("connection refused"));

  await expect(readRhythmForRequest()).rejects.toThrow("connection refused");
});
