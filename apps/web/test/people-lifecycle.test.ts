import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The lifecycle controls reach every action the registry already offered
 * (S-33, P6-G10, GAP-AUDIT B-08).
 *
 * **B-08 was four registered actions and no caller.** `people.suspend`,
 * `people.restore`, `people.convertToGuest` and `people.erase` shipped at
 * P2-T03 with their own tests in `packages/core/test/people.test.ts`, and
 * handling a leaver still meant opening a database session. What is new here
 * is the surface, so these tests read the surface.
 *
 * The domain behaviour is not re-tested here. Whether erasure anonymises
 * authorship and whether the last-owner invariant holds are already proved
 * against a real database in the core suite; repeating them against a string
 * would prove only that this file can spell.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/**
 * Source with its line wrapping taken out.
 *
 * Long copy is written as adjacent string literals joined with `+`, and Biome
 * decides where those breaks land. An assertion that encodes today's wrapping
 * fails the next time the formatter moves a word, which is a test failing when
 * the code is right.
 */
const flat = (source: string) =>
  source.replace(/"\s*\+\s*"/g, "").replace(/\s+/g, " ");

const actions = at("../app/people/lifecycle-actions.ts");
const controls = at("../app/people/[id]/lifecycle-controls.tsx");
const profile = at("../app/people/[id]/page.tsx");

describe("the people lifecycle surface", () => {
  test("calls all four actions B-08 named", () => {
    // Named one at a time rather than counted: a count still passes when one
    // action is swapped for another, and the point of this row is that each
    // of these had nothing calling it.
    for (const action of [
      "people.suspend",
      "people.restore",
      "people.convertToGuest",
      "people.erase",
    ]) {
      expect(actions).toContain(`"${action}"`);
    }
  });

  test("every confirmation says what survives, not only what stops", () => {
    // The failure this guards against is a confirmation that reads as a
    // deletion warning. Suspending, converting and erasing all keep what the
    // member wrote, and an administrator who does not know that will not
    // press the button they actually need.
    const copy = flat(controls);
    expect(copy).toContain("Their check-ins, comments and authorship all stay");
    expect(copy).toContain("Nothing they wrote is touched");
    expect(copy).toContain("reads under a placeholder identity");
  });

  test("the typed erasure confirmation is checked against the stored row", () => {
    // A hidden field carrying the expected name would make the confirmation
    // decorative, because a request that sets both to the same string passes
    // it. The action reads the member instead.
    expect(actions).toContain('"people.readMember"');
    expect(flat(actions)).toContain("typed !== name");
    expect(controls).not.toContain('name="memberName"');
  });

  test("the erasure export is rendered from the result", () => {
    // Erasing overwrites the row the export came from, so there is no second
    // call that could fetch it later. If it is not offered here it is gone.
    expect(controls).toContain('data-testid="erasure-export"');
    expect(controls).toContain("download={");
  });

  test("the card is admin-only and shown on your own profile too", () => {
    // `isLastFullAccessHolder` counts every other active member, and the
    // caller holds full access to be here at all, so the last-owner refusal
    // can only fire on yourself. Hiding the card on your own profile would
    // put that refusal out of reach of the product entirely.
    const wiring = flat(profile);
    expect(wiring).toContain("{isAdmin ? ( <LifecycleControls");
    expect(wiring).toContain("isSelf={isSelf}");
  });

  test("a refusal is rendered as an alert rather than swallowed", () => {
    expect(actions).toContain("error instanceof OperationError");
    expect(flat(controls)).toContain(
      'role={state.kind === "refused" ? "alert"',
    );
  });
});
