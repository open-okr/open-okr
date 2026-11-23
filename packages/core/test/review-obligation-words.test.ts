import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import {
  acknowledgementDueLabel,
  dueLabelFor,
  publishedAgo,
} from "../src/review/obligations.ts";

/**
 * The words the review inbox builds on the server (0.10.0 R1 D4).
 *
 * They are returned as strings in the requester's locale, so the action
 * contract keeps its shape and no stored row changes (languages.md §13).
 */
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("due and age labels", () => {
  it("keep their English wording for English", () => {
    expect(dueLabelFor(4, "2026-11-10", "en")).toBe("Overdue by 4 days");
    expect(dueLabelFor(1, null, "en")).toBe("Overdue by 1 day");
    expect(dueLabelFor(0, null, "en")).toBe("Today");
    expect(dueLabelFor(-1, null, "en")).toBe("Tomorrow");
    expect(dueLabelFor(-3, "2026-11-25", "en")).toBe("Wednesday");
    expect(acknowledgementDueLabel(0, 3, "en")).toBe("Today");
    expect(acknowledgementDueLabel(5, 3, "en")).toBe("Overdue by 5 days");
    expect(publishedAgo(0, "en")).toBe("published today");
    expect(publishedAgo(1, "en")).toBe("published yesterday");
    expect(publishedAgo(4, "en")).toBe("published 4 days ago");
  });

  it("name the weekday in the requester's language", () => {
    expect(dueLabelFor(-3, "2026-11-25", "de")).toBe("Mittwoch");
  });

  it("default to English when no locale is given", () => {
    expect(dueLabelFor(0, null)).toBe("Today");
  });
});

describe("the review action", () => {
  const source = read("../src/actions/review.ts");

  it("holds no English sentence of its own", () => {
    for (const english of [
      "Acknowledge the check-in on",
      "Post your check-in on",
      "Clear the blocker on",
      "Decide the dependency of",
      "Escalated to you",
      '"Open the task"',
      '"Open the session"',
      '"Review the proposal"',
      '"Acknowledge"',
      '"Check in"',
      '"Reviewer"',
      "Agent proposal",
    ]) {
      expect(source, english).not.toContain(english);
    }
  });

  it("only cites keys the server catalogue has", () => {
    const keys = [
      ...(source + read("../src/review/obligations.ts")).matchAll(
        /"(reviewInbox\.[A-Za-z.]+)"/g,
      ),
    ].map((match) => match[1] as string);
    expect(keys.length).toBeGreaterThan(15);
    const catalogue = en as Record<string, string>;
    // A cited prefix such as `reviewInbox.word.taskStatus` stands for a family
    // of keys that `word()` completes with the stored value.
    const names = Object.keys(catalogue);
    const missing = keys.filter(
      (key) =>
        !(key in catalogue) &&
        !names.some((name) => name.startsWith(`${key}.`)),
    );
    expect(missing).toEqual([]);
  });
});
