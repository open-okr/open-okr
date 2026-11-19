import { describe, expect, it } from "vitest";
import { isEligibleForFastPath } from "../src/copilot/fast-path.ts";
import {
  CopilotRunTimer,
  clearCopilotTimings,
  getLastCopilotTiming,
} from "../src/copilot/timing.ts";

describe("CopilotRunTimer and timing summary", () => {
  it("records timing stages and produces summary", () => {
    clearCopilotTimings();
    const timer = new CopilotRunTimer();
    timer.startPreparation();
    timer.endPreparation();
    timer.startChecks();
    timer.endChecks();
    timer.startRound();
    timer.startTool();
    timer.endTool("goals.read");
    timer.endRound();
    timer.startStreamWait();
    timer.recordFirstToken();
    const summary = timer.finish();

    expect(summary.preparationMs).toBeGreaterThanOrEqual(0);
    expect(summary.checksMs).toBeGreaterThanOrEqual(0);
    expect(summary.rounds.length).toBe(1);
    expect(summary.rounds[0]?.toolExecutions[0]?.tool).toBe("goals.read");
    expect(summary.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(summary.totalServerMs).toBeGreaterThanOrEqual(0);

    const last = getLastCopilotTiming();
    expect(last?.runId).toBe(summary.runId);
  });
});

describe("isEligibleForFastPath", () => {
  const baseAnchor = {
    historyLength: 0,
    anchorKind: "goal",
    anchorReadOutcome: "ok",
    anchorText:
      "status: on_track\nchampion: Priya\ncurrentValue: 25\ntargetValue: 50\ndueOn: 2026-12-31",
  };

  it("accepts eligible English single-record field questions", () => {
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "What is the health of this objective?",
      }),
    ).toBe(true);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Who is the champion?",
      }),
    ).toBe(true);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "What is the current value?",
      }),
    ).toBe(true);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "When is the due date?",
      }),
    ).toBe(true);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Summary of this goal",
      }),
    ).toBe(true);
  });

  it("accepts eligible Malay single-record field questions", () => {
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Apakah status objektif ini?",
      }),
    ).toBe(true);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Siapakah juara objektif ini?",
      }),
    ).toBe(true);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Apakah nilai semasa KPI ini?",
      }),
    ).toBe(true);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Ringkasan bagi matlamat ini",
      }),
    ).toBe(true);
  });

  it("rejects multi-turn questions", () => {
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        historyLength: 1,
        question: "What is the health of this objective?",
      }),
    ).toBe(false);
  });

  it("rejects unanchored or non-matching anchors", () => {
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        anchorKind: null,
        question: "What is the health of this objective?",
      }),
    ).toBe(false);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        anchorKind: "workspace",
        question: "What is the health of this objective?",
      }),
    ).toBe(false);
  });

  it("rejects refused anchor reads", () => {
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        anchorReadOutcome: "refused",
        question: "What is the health of this objective?",
      }),
    ).toBe(false);
  });

  it("rejects mutation and proposal prompts", () => {
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Propose a check-in for this goal",
      }),
    ).toBe(false);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Cadang kemaskini untuk objektif ini",
      }),
    ).toBe(false);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Create a task",
      }),
    ).toBe(false);
  });

  it("rejects comparative or multi-record prompts", () => {
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Compare this goal with other goals",
      }),
    ).toBe(false);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "List all items across teams",
      }),
    ).toBe(false);
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        question: "Bandingkan dengan objektif lain",
      }),
    ).toBe(false);
  });

  it("rejects missing fact in anchor text", () => {
    expect(
      isEligibleForFastPath({
        ...baseAnchor,
        anchorText: "title: Some goal\nno other fields here",
        question: "Who is the champion?",
      }),
    ).toBe(false);
  });
});
