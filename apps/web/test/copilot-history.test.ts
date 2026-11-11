import { describe, expect, test } from "vitest";
import { groupThreads, threadBucket } from "../app/copilot/thread-buckets.ts";

/**
 * History's groups (plan 0.8.1 CP2): when each conversation was last used,
 * in the reader's own days.
 */

// A Thursday afternoon, in the machine's own time zone, as the browser sees.
const NOW = new Date(2026, 10, 12, 15, 30);
const at = (days: number, hour = 9) =>
  new Date(2026, 10, 12 - days, hour, 0).toISOString();

describe("when a conversation was last used", () => {
  test("is today from midnight on", () => {
    expect(threadBucket(at(0, 0), NOW)).toBe("today");
    expect(threadBucket(at(0, 15), NOW)).toBe("today");
  });

  test("is yesterday for the whole of the day before", () => {
    expect(threadBucket(at(1, 23), NOW)).toBe("yesterday");
    expect(threadBucket(at(1, 0), NOW)).toBe("yesterday");
  });

  test("is this week for the seven days before today", () => {
    expect(threadBucket(at(2), NOW)).toBe("thisWeek");
    expect(threadBucket(at(6), NOW)).toBe("thisWeek");
  });

  test("is earlier before that, and for a time nobody can read", () => {
    expect(threadBucket(at(7), NOW)).toBe("earlier");
    expect(threadBucket(at(40), NOW)).toBe("earlier");
    expect(threadBucket("not a time", NOW)).toBe("earlier");
  });
});

describe("History", () => {
  test("lists the groups in order, newest first inside each, and skips empty ones", () => {
    const groups = groupThreads(
      [
        { id: "old", updatedAt: at(30) },
        { id: "morning", updatedAt: at(0, 9) },
        { id: "afternoon", updatedAt: at(0, 14) },
        { id: "monday", updatedAt: at(3) },
      ],
      NOW,
    );
    expect(groups.map((group) => group.bucket)).toEqual([
      "today",
      "thisWeek",
      "earlier",
    ]);
    expect(groups[0]?.threads.map((thread) => thread.id)).toEqual([
      "afternoon",
      "morning",
    ]);
  });
});
