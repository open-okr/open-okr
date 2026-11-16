import { describe, expect, test } from "vitest";
import { changedFields } from "../app/admin/rhythm/rhythm-state.ts";

describe("what is unsaved on the rhythm page", () => {
  const stored = {
    "threshold:cadence.stalenessGraceDays": null,
    "composite:cadence.checkInLadderDays:sponsor": 20,
    "words:quality.wordLists:outputVerbs": ["luncurkan"],
    defaultCheckInFrequency: "weekly",
    "label:space:singular": "Space",
  } as const;

  test("nothing is unsaved while every field holds what is stored", () => {
    expect(changedFields(stored, { ...stored })).toEqual([]);
  });

  test("a number typed, a number cleared and a dropdown moved are each one change", () => {
    expect(
      changedFields(stored, {
        ...stored,
        "threshold:cadence.stalenessGraceDays": 5,
        "composite:cadence.checkInLadderDays:sponsor": null,
        defaultCheckInFrequency: "daily",
      }),
    ).toEqual([
      "threshold:cadence.stalenessGraceDays",
      "composite:cadence.checkInLadderDays:sponsor",
      "defaultCheckInFrequency",
    ]);
  });

  test("a word list compares by its words, not by identity", () => {
    expect(
      changedFields(stored, {
        ...stored,
        "words:quality.wordLists:outputVerbs": ["luncurkan"],
      }),
    ).toEqual([]);
    expect(
      changedFields(stored, {
        ...stored,
        "words:quality.wordLists:outputVerbs": ["luncurkan", "terbitkan"],
      }),
    ).toEqual(["words:quality.wordLists:outputVerbs"]);
  });

  test("a rename edited and then typed back is no change", () => {
    expect(
      changedFields(stored, { ...stored, "label:space:singular": "Team" }),
    ).toEqual(["label:space:singular"]);
    expect(
      changedFields(stored, { ...stored, "label:space:singular": "Space" }),
    ).toEqual([]);
  });
});
