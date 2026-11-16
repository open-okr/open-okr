import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveThresholds } from "@openokr/method";
import { describe, expect, test } from "vitest";

/**
 * The rhythm card covers the whole §11 registry (S-36, P6-G20, GAP-AUDIT
 * G-03).
 *
 * The card was already generated from the registry rather than from a list of
 * fields, which is the part that matters most and was true from P3-T02. Three
 * things were not.
 *
 * A composite parameter rendered as `JSON.stringify` of its resolved value
 * with a note saying no screen specified how to edit one, so every escalation
 * ladder, every band set and every bounds pair could be read and not changed.
 * A refusal was caught and dropped, so an impossible value looked exactly like
 * a successful save. And there was no way to put a card back.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const form = at("../app/admin/rhythm/rhythm-form.tsx");
const actions = at("../app/admin/rhythm/rhythm-actions.ts");

/** The registry's shapes, counted from the registry itself. */
const resolved = resolveThresholds() as Record<string, unknown>;
const composite = Object.entries(resolved).filter(
  ([, value]) =>
    value !== null &&
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every(
      (part) => typeof part === "number",
    ),
);
const lists = composite.filter(([, value]) => Array.isArray(value));

describe("the rhythm and thresholds card", () => {
  test("is generated from the registry, not from a list of fields", () => {
    // The claim worth protecting: a threshold added to METHOD.md next month
    // appears here with no change to this file.
    expect(form).toContain("rhythm.registry.filter");
    expect(form).toContain("rhythm.thresholds[entry.key]");
    // And no threshold key is written into the component.
    for (const key of Object.keys(resolved)) {
      expect(form).not.toContain(`"${key}"`);
    }
  });

  test("every composite parameter is editable, not just readable", () => {
    // There are eighteen of these and they were all read-only.
    expect(composite.length).toBeGreaterThan(10);
    expect(form).toContain("numericParts(resolved)");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the needle is source text, matched literally
    expect(form).toContain("`${prefix}:${entry.key}:${part}`");
  });

  test("a list parameter goes back as a list", () => {
    // Two of the composites are `z.array` in §11, and an object keyed by
    // index is refused by the schema.
    expect(lists).toHaveLength(2);
    expect(form).toContain('Array.isArray(resolved) ? "list" : "composite"');
    expect(actions).toContain("isList");
  });

  test("a half-written set is refused rather than sent", () => {
    // A ladder with one rung filled in is worse than the canon's, and the
    // action would have taken it.
    expect(actions).toContain("values.some((part) => part === null)");
  });

  test("the refusal is returned rather than swallowed", () => {
    // This is the whole of what the previous save did with an OperationError:
    // `return;`. An impossible value and a successful save looked identical.
    // A schema's refusal is returned too since plan U1b, as `key: message`
    // so it lands under its parameter like the action's own.
    expect(actions).toContain("return { error: refused, saved: null }");
    expect(actions).toContain("return `${group}.${name}: ${message}`");
  });

  test("the refusal comes to the reader, and names its own field", () => {
    // **It used to render at the top of the card and be invisible.** A card
    // runs to 1,700px, so a refusal raised from the bottom of twenty
    // parameters was off the top of the window with nothing to suggest it
    // existed. It is now in the save bar, under the field the method named,
    // and the field is brought into view and marked invalid.
    expect(form).toContain("SettingsSaveBar");
    expect(form).toContain("error={state.error}");
    expect(form).toContain("refusedParameter");
    expect(form).toContain("focusRefused");
    expect(form).toContain("invalid={refusal !== null}");
    expect(form).toContain(
      "aria-describedby={refusal === null ? undefined : errorId}",
    );
    expect(form).toContain('data-testid="rhythm-field-error"');
    // One bar says it, so no toast says it a second time.
    expect(form).not.toContain("useToast");
  });

  test("reset blanks the card in the browser, and the save sends the blanks as nulls", () => {
    // Storing today's default is not the same as having no opinion: the
    // stored copy keeps winning after the canon itself moves. A blank field
    // is a null in the save, and the reset is no server call of its own.
    expect(actions).toContain('value === "" ? null : Number(value)');
    expect(actions).not.toContain("resetGroup");
    expect(form).toContain('t("common.resetToDefaults")');
    expect(form).toContain("resetCard(group)");
    expect(form).not.toContain("window.confirm");
  });

  test("the page is one form with one save bar, so every card saves together", () => {
    // Measured on 22 September 2026: one Save sat 7,785px below the first of
    // the 123 fields it governed. Per-card saves fixed the distance and cost
    // eight buttons, a sticky header on each and a toast apiece. The settings
    // layout standard is one object with one bar, which names the cards that
    // changed.
    expect(form).toContain("function SettingsCard");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the needle is source text, matched literally
    expect(form).toContain("data-testid={`rhythm-card-${id}`}");
    expect(form).toContain("id={FORM_ID}");
    expect(form).toContain("unsaved={unsaved}");
    // A card has no Save of its own.
    expect(form.match(/<form\b/g)).toHaveLength(1);
    expect(form).not.toContain("sticky top-0");
  });

  test("the action sends only what arrived", () => {
    // `rhythm.update` takes every field as optional and merges `overrides`.
    // Reading `form.get("checkInAnchorDay")` unconditionally would send null
    // for the cadence settings from any form that does not hold them.
    expect(actions).toContain('form.has("checkInAnchorDay")');
    expect(actions).toContain("sawThreshold");
    expect(actions).toContain("Object.keys(patch).length === 0");
  });

  test("unsaved work is guarded and ⌘⏎ saves", () => {
    // Neither existed anywhere in this product: a grep for `beforeunload`
    // across apps/web returned one comment, and no admin form bound the ⌘⏎
    // that UIUX-PLAN.md §4 lists.
    expect(form).toContain("useUnsavedGuard");
    expect(form).toContain("useSubmitShortcut");
    expect(form).toContain("changedFields");
  });

  test("every threshold explains what its reason cites and where the method sets it out", () => {
    // A reason that says "(principle 5)" sent the reader to a document they
    // did not have open. The page works each hint out from the package, so a
    // principle or section can only be named the way METHOD.md names it.
    const page = at("../app/admin/rhythm/page.tsx");
    expect(page).toContain("principlesCited(entry.why)");
    expect(page).toContain("methodSectionAnchor(cited)");
    expect(form).toContain(
      "<ThresholdHintButton name={entry.label} hint={hint} />",
    );
    // The two thresholds the check-in card shows as dropdowns have no reason
    // on the card, so theirs is in the hint.
    expect(form).toContain("hint={checkInHints.defaultCheckInFrequency}");
    expect(form).toContain("hint={checkInHints.checkInAnchorDay}");
    expect(form.match(/withReason\n/g)).toHaveLength(2);
  });

  test("a blank box is the canon, not zero", () => {
    // `Number("")` is 0, which would have written a real override of zero
    // every time somebody cleared a field.
    expect(actions).toContain('value === "" ? null : Number(value)');
  });
});
