// @vitest-environment jsdom
import { type EntityOption, TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { reviewerIsChampion } from "../lib/reviewer-is-champion.ts";

/**
 * A goal's reviewer who is also its champion is warned about, never refused
 * (plan 0.7.0, O3; okr-core-domain.md §4.1).
 *
 * METHOD.md §2.5 asks for a different person where possible, and a one-person
 * team has nobody else, so the write always goes through. What was missing was
 * the warning: the drafting step said the rule in a fixed line whether or not
 * it applied, and no screen said it when it did.
 *
 * **The kit's picker is a combobox jsdom cannot drive**, so a stand-in that
 * chooses on a press takes its place here. The claims are about the fields
 * around it agreeing on who was chosen; choosing in the real picker is
 * `packages/ui/test/entity-picker.test.tsx`.
 */

vi.mock("@openokr/ui", async (original) => ({
  ...(await original<typeof import("@openokr/ui")>()),
  EntityPicker: ({
    label,
    options,
    noneLabel,
    onValueChange,
  }: {
    label: string;
    options: readonly EntityOption[];
    noneLabel?: string;
    onValueChange?: (id: string | null) => void;
  }) => (
    <fieldset aria-label={label}>
      {noneLabel === undefined ? null : (
        <button type="button" onClick={() => onValueChange?.(null)}>
          {noneLabel}
        </button>
      )}
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onValueChange?.(option.id)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  ),
}));

const { ReviewerIsChampionNote } = await import(
  "../lib/reviewer-is-champion-note.tsx"
);
const { ChampionAndReviewer } = await import(
  "../app/cycle/champion-and-reviewer.tsx"
);

const PRIYA = "00000000-0000-7000-8000-000000000001";
const MEI = "00000000-0000-7000-8000-000000000002";
const PEOPLE: readonly EntityOption[] = [
  { id: PRIYA, label: "Priya", avatar: true },
  { id: MEI, label: "Mei", avatar: true },
];

describe("whether the reviewer is the champion", () => {
  test("is true only when both name the same member", () => {
    expect(reviewerIsChampion(PRIYA, PRIYA)).toBe(true);
    expect(reviewerIsChampion(PRIYA, MEI)).toBe(false);
  });

  test("is false with no reviewer, which is not the same person", () => {
    expect(reviewerIsChampion(PRIYA, null)).toBe(false);
    expect(reviewerIsChampion(PRIYA, undefined)).toBe(false);
    expect(reviewerIsChampion(null, null)).toBe(false);
  });
});

describe("the note on a screen that shows both", () => {
  const rendered = (reviewerId: string | null) =>
    renderToString(
      <TranslationsProvider locale="en">
        <ReviewerIsChampionNote
          championId={PRIYA}
          reviewerId={reviewerId}
          name="Priya"
        />
      </TranslationsProvider>,
    );

  test("names the person and asks for another reviewer when one holds both", () => {
    const html = rendered(PRIYA);
    expect(html).toContain("Priya is both owner and reviewer");
    expect(html).toContain("Name another reviewer");
  });

  test("says nothing when somebody else reviews it, or nobody does", () => {
    expect(rendered(MEI)).toBe("");
    expect(rendered(null)).toBe("");
  });
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function draw(reviewer: "off" | "optional" | "required") {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <form>
          <ChampionAndReviewer
            people={PEOPLE}
            defaultChampionId={PRIYA}
            reviewer={reviewer}
          />
        </form>
      </TranslationsProvider>,
    );
  });
}

async function choose(field: "Owner" | "Reviewer", name: string) {
  const button = [
    ...(container
      .querySelector(`fieldset[aria-label="${field}"]`)
      ?.querySelectorAll("button") ?? []),
  ].find((one) => one.textContent === name);
  expect(button, `${field}: ${name}`).toBeDefined();
  await act(async () => button?.click());
}

const warning = () =>
  container.querySelector('[role="status"]')?.textContent ?? "";

describe("the drafting form's champion and reviewer", () => {
  test("warns as soon as the reviewer chosen is the champion, and not before", async () => {
    await draw("optional");
    expect(warning()).toBe("");

    await choose("Reviewer", "Priya");
    expect(warning()).toContain("The same person is owner and reviewer");
    // Never refused: the form keeps its submit, and the warning says why.
    expect(warning()).toContain("one person may hold both");

    await choose("Reviewer", "Mei");
    expect(warning()).toBe("");
  });

  test("warns when the champion moves onto the reviewer, too", async () => {
    await draw("required");
    await choose("Reviewer", "Mei");
    expect(warning()).toBe("");
    await choose("Owner", "Mei");
    expect(warning()).toContain("The same person is owner and reviewer");
  });

  test("forgets the choice when the form resets after a save", async () => {
    await draw("optional");
    await choose("Reviewer", "Priya");
    expect(warning()).not.toBe("");
    await act(async () => container.querySelector("form")?.reset());
    expect(warning()).toBe("");
  });

  test("offers no reviewer, and so never warns, where the practice has none", async () => {
    await draw("off");
    expect(container.querySelector('fieldset[aria-label="Reviewer"]')).toBe(
      null,
    );
    await choose("Owner", "Mei");
    expect(warning()).toBe("");
  });
});
