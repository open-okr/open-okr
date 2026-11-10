import { DEFAULT_PROMPTS, PROMPT_KEYS } from "@openokr/core";
import { describe, expect, it } from "vitest";
import { latestEvaluations } from "../lib/prompt-evaluation";

/**
 * The usage card's latest evaluation results (plan 0.7.0 A9,
 * docs/design/ai-evaluation.md §9).
 *
 * Through the real evaluation set, not a stand-in: what the card says has to
 * be what the gate and the drafter decide, and they all call the same set.
 */
describe("latestEvaluations", () => {
  it("passes the built-in text, and says a failing stored version is not sent", async () => {
    const rows = await latestEvaluations([
      {
        promptKey: PROMPT_KEYS.draftObjective,
        version: 0,
        isDefault: true,
        systemPrompt: DEFAULT_PROMPTS[PROMPT_KEYS.draftObjective],
      },
      {
        promptKey: PROMPT_KEYS.rewriteForRule,
        version: 2,
        isDefault: false,
        // Saved before the gate existed, or brought in by an archive import.
        systemPrompt: "Ask priya@northwind.example before you rewrite.",
      },
    ]);

    const [objective, rewrite] = rows;
    expect(objective).toMatchObject({
      promptKey: "draft.objective",
      isDefault: true,
      failedChecks: [],
      sent: true,
    });
    expect(objective?.passed).toBe(objective?.fixtures);
    expect(objective?.fixtures).toBeGreaterThanOrEqual(2);

    expect(rewrite).toMatchObject({
      promptKey: "rewrite.failing_rule",
      version: 2,
      passed: 0,
      failedChecks: ["personal-data"],
      sent: false,
    });
  });

  it("keeps a stored version that passes as the one sent", async () => {
    const [row] = await latestEvaluations([
      {
        promptKey: PROMPT_KEYS.rewriteForRule,
        version: 3,
        isDefault: false,
        systemPrompt:
          "Rewrite the key result so it passes the named check. One line. Keep its numbers.",
      },
    ]);
    expect(row).toMatchObject({ failedChecks: [], sent: true });
  });
});
