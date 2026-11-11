import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AnswerText,
  parseAnswer,
  parseInline,
} from "../src/components/answer-text.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * A model's answer with the little formatting models write (plan 0.8.1 CP4,
 * review F8).
 *
 * Acceptance criteria:
 *   Given an answer containing `**on track**` and a three-line `- ` list,
 *   when it is shown, then "on track" is bold, the list is a list, and no
 *   asterisk or dash shows.
 *   Given an answer containing `[click](javascript:alert(1))` or
 *   `https://example.com`, when it is shown, then neither is a link; the
 *   text shows as typed.
 *   Given an answer ending mid-stream in `**on tr`, when it is shown, then
 *   the characters show as typed, and the page does not break.
 */

const shown = (text: string) =>
  render(
    <TranslationsProvider locale="en">
      <AnswerText text={text} />
    </TranslationsProvider>,
  ).container;

describe("formatting a model writes", () => {
  it("draws bold and a list, and no marker shows", () => {
    const box = shown(
      "Activation is **on track** this quarter.\n\n- Onboarding calls\n- The new checklist\n- Weekly reviews",
    );
    expect(box.querySelector("strong")?.textContent).toBe("on track");
    const items = [...box.querySelectorAll("ul > li")].map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "Onboarding calls",
      "The new checklist",
      "Weekly reviews",
    ]);
    expect(box.textContent).not.toContain("*");
    expect(box.textContent).not.toContain("- ");
  });

  it("draws italics and inline code, and keeps a numbered list's first number", () => {
    const box = shown("3. *Ask* the `champion`\n4. Wait");
    const list = box.querySelector("ol");
    expect(list?.getAttribute("start")).toBe("3");
    expect(list?.querySelector("em")?.textContent).toBe("Ask");
    expect(list?.querySelector("code")?.textContent).toBe("champion");
  });

  it("keeps a line break inside a paragraph, and splits paragraphs on a blank line", () => {
    const box = shown("First line\nsecond line\n\nNext paragraph");
    const paragraphs = box.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelectorAll("br")).toHaveLength(1);
  });

  it("draws a fenced block as code, with Copy once it is closed", () => {
    const box = shown("Run this:\n\n```sh\npnpm okr goals list\n```\n");
    expect(box.querySelector("pre code")?.textContent).toBe(
      "pnpm okr goals list",
    );
    const copy = [...box.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy",
    );
    expect(copy).toBeDefined();
  });

  it("offers no Copy on a block still arriving", () => {
    const box = shown("```sh\npnpm okr goals");
    expect(box.querySelector("pre code")?.textContent).toBe("pnpm okr goals");
    expect(box.querySelector("button")).toBeNull();
  });
});

describe("what it never does", () => {
  it("makes no link from a Markdown link, whatever its address", () => {
    const box = shown("[click](javascript:alert(1)) and [docs](https://x.y)");
    expect(box.querySelector("a")).toBeNull();
    expect(box.textContent).toBe(
      "[click](javascript:alert(1)) and [docs](https://x.y)",
    );
  });

  it("makes no link from an address", () => {
    const box = shown("See https://example.com for more.");
    expect(box.querySelector("a")).toBeNull();
    expect(box.textContent).toBe("See https://example.com for more.");
  });

  it("draws markup as the characters it is", () => {
    const box = shown(
      '<script>alert(1)</script><img src=x onerror="alert(1)"> <b>bold</b>',
    );
    expect(box.querySelector("script")).toBeNull();
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelector("b")).toBeNull();
    expect(box.textContent).toContain("<script>alert(1)</script>");
  });

  it("shows a half-written marker as typed", () => {
    const box = shown("Activation is **on tr");
    expect(box.querySelector("strong")).toBeNull();
    expect(box.textContent).toBe("Activation is **on tr");
  });

  it("leaves a marker inside inline code alone", () => {
    const box = shown("Type `**not bold**` to see");
    expect(box.querySelector("strong")).toBeNull();
    expect(box.querySelector("code")?.textContent).toBe("**not bold**");
  });

  it("does not read emphasis inside a word, or from a spaced-out asterisk", () => {
    expect(parseInline("snake_case_name and a * b * c")).toEqual([
      { kind: "text", text: "snake_case_name and a * b * c" },
    ]);
  });

  it("keeps an escaped marker as the character", () => {
    expect(parseInline("\\*not em\\*")).toEqual([
      { kind: "text", text: "*not em*" },
    ]);
  });

  it("reads a long run of unmatched markers without stalling", () => {
    const started = performance.now();
    const blocks = parseAnswer(`${"*".repeat(20_000)}${"_x".repeat(5_000)}`);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(blocks).toHaveLength(1);
  });
});
