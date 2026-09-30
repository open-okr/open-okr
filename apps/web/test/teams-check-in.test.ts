import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The Teams check-in card, at the door it arrives through (AI-NATIVE-PLAN
 * §5.3, completeness review M-23).
 *
 * The card and its parser are proved against recorded Teams payloads in
 * `packages/adapters/test/channel-teams.test.ts`, and the write they end in is
 * proved against a real database in `packages/core/test/chat-check-in.test.ts`.
 * What only this file can see is the wiring between them: that the route reads
 * a submission after §6's checks rather than before them, and that it ends in
 * the one write every other channel uses.
 */

const route = readFileSync(
  fileURLToPath(new URL("../app/api/channels/teams/route.ts", import.meta.url)),
  "utf8",
);

describe("the Teams check-in card", () => {
  test("is handled in `instead`, which runs after verification and identity", () => {
    // `beforeMessage` runs before the duplicate check, the identity lookup and
    // the rate limit. A submission read there would need all three again.
    expect(route).not.toContain("beforeMessage");
    expect(route).toContain("async instead(");
    expect(route).toContain("parseCardSubmission(rawBody)");
  });

  test("ends in the shared check-in write, with no path of its own", () => {
    expect(route).toContain("submitCheckIn(");
    expect(route).toContain('provider: "teams"');
    expect(route).not.toContain('"goals.publishCheckIn"');
  });

  test("opens the card for checkin with a goal, and reads the goal as the member", () => {
    expect(route).toContain("CHECK_IN_COMMAND");
    expect(route).toContain("checkInCard(");
    expect(route).toContain('"goals.read"');
    expect(route).toContain('actor: { kind: "human", userId }');
  });

  test("replies to the service URL the verified token bound", () => {
    expect(route).toContain("teamsServiceUrl(rawBody)");
  });
});
