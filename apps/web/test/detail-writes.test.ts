import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The detail-page writes that had no browser caller (P6-G27, GAP-AUDIT §5).
 *
 * Every action here shipped with its entity and could be reached only from the
 * command line or the API. What is checked is that a screen calls each one, and
 * the two decisions that are not obvious: one delete path rather than four, and
 * a reaction that can be taken back.
 *
 * The writes themselves are proved in `packages/core`. The end-to-end suite
 * proves the move, which is this row's acceptance criterion.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const deleteAction = at("../lib/delete-action.ts");
const deleteControl = at("../lib/delete-control.tsx");

describe("delete", () => {
  test("is one path with an allow-list, not four server actions", () => {
    // A server action takes whatever the browser sends, so the switch over
    // four literals is what stops this becoming a way to call any action in
    // the registry with any id.
    for (const action of [
      '"goals.delete"',
      '"initiatives.delete"',
      '"tasks.delete"',
      '"documents.delete"',
    ]) {
      expect(deleteAction, action).toContain(action);
    }
    expect(deleteAction).toContain("const ACTION = {");
  });

  test("states the soft-delete semantics on the confirmation", () => {
    // The thing worth telling somebody is not "are you sure" but what a delete
    // is in this product, and that does not fit in a dialog title.
    expect(deleteControl).toContain("Nothing is destroyed");
    expect(deleteControl).toContain("the history stays readable");
    // Two presses, so the sentence is read before the second one.
    expect(deleteControl).toContain("armed ? (");
  });

  test("is on all four detail pages, and only above `full`", () => {
    const pages: ReadonlyArray<readonly [string, string]> = [
      ["../app/goals/[id]/goal-writes.tsx", "goal"],
      ["../app/initiatives/[id]/page.tsx", "initiative"],
      ["../app/tasks/[id]/page.tsx", "task"],
      ["../app/documents/[id]/page.tsx", "document"],
    ];
    for (const [path, subject] of pages) {
      const source = at(path);
      expect(source, subject).toContain(`subject="${subject}"`);
      // The four actions all require `full`, so a button that appeared and
      // then failed would be the interface lying about what the reader can do.
      expect(source, subject).toMatch(/canAdminister|ACCESS_LEVELS\.full/);
    }
  });
});

describe("the goal writes", () => {
  const writes = at("../app/goals/[id]/write-actions.ts");

  test("reach the two actions that had no caller", () => {
    expect(writes).toContain('"goals.moveToCycle"');
    expect(writes).toContain('"goals.unlinkKpi"');
  });

  test("revalidate the whole tree, because a move changes two cycles", () => {
    // The scorecard, the cycle screen and the Work Map all count by cycle, and
    // none of them is this page.
    expect(writes.split('revalidatePath("/", "layout")').length - 1).toBe(2);
  });

  test("offer an unlink only where a key result has a KPI", () => {
    const card = at("../app/goals/[id]/goal-writes.tsx");
    expect(card).toContain("linkedKeyResults.length > 0");
    // And say what unlinking keeps, because the alternative reading is that
    // the measure is reset. The sentence is in the catalogue (P6-G22b), so
    // the card carries its key.
    expect(card).toContain('t("goal.writes.unlinkHelp")');
  });
});

describe("reactions", () => {
  test("the read hands back the caller's own id, which is what remove needs", () => {
    const service = at("../../../packages/core/src/comments/service.ts");
    const action = at("../../../packages/core/src/actions/comments.ts");
    expect(service).toContain("ownReactionId");
    expect(action).toContain("ownReactionId: z.string().uuid().nullable()");
  });

  test("the toggle is finally a toggle", () => {
    // It was named one and only ever added, so pressing an emoji a second time
    // did nothing and a reaction given by mistake stayed for good.
    const actions = at("../app/goals/[id]/actions.ts");
    expect(actions).toContain('"reactions.remove"');
    expect(actions).toContain("if (ownReactionId) {");
  });
});

describe("the checklist", () => {
  test("a line can be taken off, which is not the same as ticking it", () => {
    const board = at("../app/board/actions.ts");
    expect(board).toContain('"tasks.removeChecklistItem"');
    const controls = at("../app/tasks/[id]/controls.tsx");
    expect(controls).toContain("onRemove");
    // Not offered where the reader cannot edit.
    expect(controls).toContain("onRemove && !disabled");
  });
});
