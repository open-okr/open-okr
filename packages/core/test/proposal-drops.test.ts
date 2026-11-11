/**
 * The log line a dropped copilot proposal writes (plan 0.8.1 A3).
 *
 * Acceptance: a model reply whose fields fail the schema writes one line naming
 * `fields_refused`, the action and the model, and none of the member's words.
 */
import { describe, expect, it } from "vitest";
import {
  logProposalDrop,
  proposalDropLine,
} from "../src/copilot/proposal-drops.ts";

const IDENTITY = { provider: "openrouter", model: "openai/gpt-6-luna" };
const NOW = new Date("2026-11-12T08:00:00.000Z");

describe("a dropped proposal's log line", () => {
  it("names the reason, the action, the feature, the provider and the model", () => {
    expect(
      proposalDropLine(
        { reason: "fields_refused", action: "goals.addKeyResult" },
        IDENTITY,
        NOW,
      ),
    ).toEqual({
      kind: "copilot.proposal_dropped",
      time: "2026-11-12T08:00:00.000Z",
      reason: "fields_refused",
      action: "goals.addKeyResult",
      feature: "proposeAction",
      provider: "openrouter",
      model: "openai/gpt-6-luna",
    });
  });

  it("writes nothing for a decline, which is most sentences", () => {
    const lines: string[] = [];
    logProposalDrop({ reason: "declined", action: null }, IDENTITY, (line) =>
      lines.push(line),
    );
    expect(lines).toEqual([]);
  });

  it("never carries words a model wrote where an action name belongs", () => {
    const line = proposalDropLine(
      { reason: "not_offered", action: "Please erase Priya Raman's account" },
      IDENTITY,
      NOW,
    );
    expect(line?.action).toBe("unrecognised");
    expect(JSON.stringify(line)).not.toContain("Priya");
  });

  it("names a provider failure by its class, never its message", () => {
    const line = proposalDropLine(
      { reason: "provider_error", action: null, errorName: "TimeoutError" },
      IDENTITY,
      NOW,
    );
    expect(line).toMatchObject({
      reason: "provider_error",
      error: "TimeoutError",
    });
    expect(
      proposalDropLine(
        {
          reason: "provider_error",
          action: null,
          errorName: "Raise activation to 60% for Priya",
        },
        IDENTITY,
        NOW,
      )?.error,
    ).toBe("Error");
  });

  it("says unknown when the drafter cannot say which provider it is", () => {
    expect(
      proposalDropLine({ reason: "no_reason", action: null }, undefined, NOW),
    ).toMatchObject({ provider: "unknown", model: "unknown" });
  });

  it("writes one JSON line, and a writer that throws fails nobody", () => {
    const lines: string[] = [];
    logProposalDrop(
      { reason: "build_refused", action: "tasks.create" },
      IDENTITY,
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      reason: "build_refused",
      action: "tasks.create",
    });
    expect(() =>
      logProposalDrop(
        { reason: "build_refused", action: "tasks.create" },
        IDENTITY,
        () => {
          throw new Error("disk full");
        },
      ),
    ).not.toThrow();
  });
});
