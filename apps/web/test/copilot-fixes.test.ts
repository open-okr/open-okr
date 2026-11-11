import { describe, expect, test } from "vitest";
import { type CopilotFixFacts, copilotFixes } from "../app/copilot/fixes.ts";

/**
 * The link S-39 asks for beside "AI off" (plan 0.8.1 CP8).
 *
 * Acceptance criterion: given no AI provider and a member who holds
 * `manage_ai`, when the panel opens, then it shows Open AI settings; a member
 * without it sees no link.
 */
const facts = (over: Partial<CopilotFixFacts>): CopilotFixFacts => ({
  available: false,
  offReason: "no_provider",
  reachesAiSettings: false,
  reachesPlan: false,
  personalKeysOffered: false,
  ...over,
});

describe("where AI off sends somebody", () => {
  test("an administrator with no provider is sent to the AI page", () => {
    expect(copilotFixes(facts({ reachesAiSettings: true }))).toEqual([
      "aiSettings",
    ]);
  });

  test("a member who cannot open the AI page is sent nowhere", () => {
    expect(copilotFixes(facts({}))).toEqual([]);
  });

  test("a member is sent to their own keys where the workspace takes them", () => {
    expect(copilotFixes(facts({ personalKeysOffered: true }))).toEqual([
      "personalKeys",
    ]);
  });

  test("a plan with no credits sends an administrator to the plan and the AI page", () => {
    expect(
      copilotFixes(
        facts({
          offReason: "plan_without_credits",
          reachesAiSettings: true,
          reachesPlan: true,
          personalKeysOffered: true,
        }),
      ),
    ).toEqual(["aiSettings", "plan"]);
  });

  test("credits spent for the month are bought on the plan page only", () => {
    expect(
      copilotFixes(
        facts({
          offReason: "credits_used",
          reachesAiSettings: true,
          reachesPlan: true,
        }),
      ),
    ).toEqual(["plan"]);
  });

  test("no plan page is offered where the instance has no plans", () => {
    expect(
      copilotFixes(
        facts({ offReason: "plan_without_credits", reachesAiSettings: true }),
      ),
    ).toEqual(["aiSettings"]);
  });

  test("a cap is lifted on the AI page", () => {
    expect(
      copilotFixes(facts({ offReason: null, reachesAiSettings: true })),
    ).toEqual(["aiSettings"]);
  });

  test("nothing is offered while the copilot can answer", () => {
    expect(
      copilotFixes(
        facts({
          available: true,
          offReason: null,
          reachesAiSettings: true,
          reachesPlan: true,
          personalKeysOffered: true,
        }),
      ),
    ).toEqual([]);
  });
});
