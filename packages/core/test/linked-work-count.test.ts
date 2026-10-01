import { describe, expect, it } from "vitest";
import {
  countLinkedWork,
  type LinkedWorkTask,
} from "../src/tasks/linked-work.ts";

/**
 * What counts as a key result's linked work (REQUIREMENTS §4 Pillar C,
 * TECHNICAL-PLAN §4.9, completeness review M-26).
 *
 * Pure, so no database: the queries that load these rows are proved in
 * `tasks.test.ts` and `linked-work-finding.test.ts`.
 */
describe("what counts as linked work", () => {
  // Two key results, and initiatives serving them. The count is per key result.
  const ACTIVATION = "kr-activation";
  const RETENTION = "kr-retention";

  const task = (
    id: string,
    done: boolean,
    links: { keyResultId?: string; initiativeId?: string } = {},
  ): LinkedWorkTask => ({
    id,
    done,
    keyResultId: links.keyResultId ?? null,
    initiativeId: links.initiativeId ?? null,
  });

  it("counts a task that names the key result itself", () => {
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [
        task("a", true, { keyResultId: ACTIVATION }),
        task("b", false, { keyResultId: ACTIVATION }),
      ],
      initiatives: [],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 2 });
  });

  it("counts an initiative's own tasks for the key result it serves", () => {
    // The initiative's progress is the share of its own tasks that are done,
    // so its tasks are how that progress reaches the key result.
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [
        task("a", true, { initiativeId: "onboarding" }),
        task("b", false, { initiativeId: "onboarding" }),
      ],
      initiatives: [
        { initiativeId: "onboarding", keyResultId: ACTIVATION, dropped: false },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 2 });
  });

  it("counts a task once when it names the key result and sits in an initiative serving it", () => {
    // Two routes to one piece of work. Counting it twice would let the same
    // finished task look like twice the plan.
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [
        task("a", true, {
          keyResultId: ACTIVATION,
          initiativeId: "onboarding",
        }),
        task("b", false, { initiativeId: "onboarding" }),
      ],
      initiatives: [
        { initiativeId: "onboarding", keyResultId: ACTIVATION, dropped: false },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 2 });
  });

  it("counts a task once when the same row arrives twice", () => {
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [
        task("a", true, { keyResultId: ACTIVATION }),
        task("a", true, { keyResultId: ACTIVATION }),
      ],
      initiatives: [],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 1 });
  });

  it("counts a task once when the same link arrives twice", () => {
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [task("a", true, { initiativeId: "onboarding" })],
      initiatives: [
        { initiativeId: "onboarding", keyResultId: ACTIVATION, dropped: false },
        { initiativeId: "onboarding", keyResultId: ACTIVATION, dropped: false },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 1 });
  });

  it("adds up several initiatives serving one key result without multiplying", () => {
    // Each task belongs to one initiative, so each arrives once. The count is
    // the sum of the tasks, not tasks times initiatives.
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [
        task("a", true, { initiativeId: "onboarding" }),
        task("b", false, { initiativeId: "pricing" }),
      ],
      initiatives: [
        { initiativeId: "onboarding", keyResultId: ACTIVATION, dropped: false },
        { initiativeId: "pricing", keyResultId: ACTIVATION, dropped: false },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 2 });
  });

  it("counts an initiative serving two key results in full for each", () => {
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION, RETENTION],
      tasks: [
        task("a", true, { initiativeId: "onboarding" }),
        task("b", false, { initiativeId: "onboarding" }),
      ],
      initiatives: [
        { initiativeId: "onboarding", keyResultId: ACTIVATION, dropped: false },
        { initiativeId: "onboarding", keyResultId: RETENTION, dropped: false },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 2 });
    expect(counted.get(RETENTION)).toEqual({ done: 1, total: 2 });
  });

  it("counts a task naming one key result for another its initiative serves", () => {
    // The task names retention, and its initiative serves activation as well.
    // It is part of the initiative's progress, so it is part of activation's
    // linked work too, and it is still one task for retention.
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION, RETENTION],
      tasks: [
        task("a", true, {
          keyResultId: RETENTION,
          initiativeId: "onboarding",
        }),
      ],
      initiatives: [
        { initiativeId: "onboarding", keyResultId: ACTIVATION, dropped: false },
        { initiativeId: "onboarding", keyResultId: RETENTION, dropped: false },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 1 });
    expect(counted.get(RETENTION)).toEqual({ done: 1, total: 1 });
  });

  it("takes nothing from a dropped initiative, except a task that names the key result itself", () => {
    // A dropped initiative is work the team decided not to do. Its open tasks
    // would hold the count below complete for good, and the divergence would
    // never be allowed to speak.
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [
        task("a", false, { initiativeId: "abandoned" }),
        task("b", true, { initiativeId: "abandoned" }),
        task("c", true, {
          keyResultId: ACTIVATION,
          initiativeId: "abandoned",
        }),
      ],
      initiatives: [
        { initiativeId: "abandoned", keyResultId: ACTIVATION, dropped: true },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 1, total: 1 });
  });

  it("ignores a task whose initiative serves no key result asked about", () => {
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [task("a", true, { initiativeId: "elsewhere" })],
      initiatives: [
        { initiativeId: "elsewhere", keyResultId: RETENTION, dropped: false },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 0, total: 0 });
    expect(counted.has(RETENTION)).toBe(false);
  });

  it("answers zero of zero for a key result nothing is linked to", () => {
    // An initiative with no tasks lands here too: its own progress has nothing
    // under it, so it adds nothing to the key result's.
    const counted = countLinkedWork({
      keyResultIds: [ACTIVATION],
      tasks: [],
      initiatives: [
        { initiativeId: "empty", keyResultId: ACTIVATION, dropped: false },
      ],
    });
    expect(counted.get(ACTIVATION)).toEqual({ done: 0, total: 0 });
  });
});
