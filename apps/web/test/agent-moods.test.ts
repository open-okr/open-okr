import { TRIGGER_CATALOGUE } from "@openokr/method";
import { describe, expect, test } from "vitest";
import {
  faceForTrigger,
  MOODED_TRIGGERS,
  moodForRun,
} from "../lib/agent-moods.ts";

/**
 * The faces proactive messages wear (docs/design/agent-faces.md §3).
 *
 * The typecheck already refuses a trigger with no mood. This is the runtime
 * half: the map and the catalogue hold the same keys in both directions, so a
 * trigger renamed in the method package cannot leave a mood behind for a key
 * nothing sends.
 */
describe("agent moods", () => {
  test("every trigger in the catalogue has a mood, and nothing else does", () => {
    const keys = TRIGGER_CATALOGUE.map((entry) => entry.key);
    expect([...MOODED_TRIGGERS].sort()).toEqual([...keys].sort());
  });

  test("a nudge wears the face of the agent that owns its rule", () => {
    for (const entry of TRIGGER_CATALOGUE) {
      expect(faceForTrigger(entry.key)?.agent).toBe(entry.owner);
    }
    expect(faceForTrigger("checkin.overdue")).toEqual({
      agent: "champion",
      mood: "sad",
    });
    expect(faceForTrigger("quality.no_baseline")).toEqual({
      agent: "coach",
      mood: "thinking",
    });
  });

  test("a key the catalogue does not define draws no face", () => {
    expect(faceForTrigger("no.such_rule")).toBeNull();
  });

  test("a run's face says where the run got to", () => {
    expect(moodForRun("running", 0)).toEqual({ mood: "thinking", live: true });
    expect(moodForRun("planning", 0)).toEqual({ mood: "thinking", live: true });
    expect(moodForRun("completed", 3).mood).toBe("happy");
    expect(moodForRun("completed", 0).mood).toBe("idle");
    // A halt is a limit the workspace chose, not a failure.
    expect(moodForRun("cancelled", 1).mood).toBe("sleeping");
    expect(moodForRun("failed", 1).mood).toBe("sad");
  });
});
