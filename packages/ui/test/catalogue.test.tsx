import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  buildPseudoCatalogue,
  CATALOGUES,
  findUnwrappedText,
  messageHoles,
  missingKeys,
  toPseudoLocale,
  translate,
} from "../src/i18n/catalogue.ts";
import {
  TranslationsProvider,
  useTranslations,
} from "../src/i18n/use-translations.tsx";

describe("the message catalogue", () => {
  test("Bahasa Melayu carries every key the English source does (§8: keys stubbed)", () => {
    expect(missingKeys("ms")).toEqual([]);
  });

  test("translate throws rather than fabricating a fallback for a missing key", () => {
    expect(() => translate(CATALOGUES.en, "no.such.key")).toThrow();
  });
});

/**
 * A message carries values (P6-G22d).
 *
 * The codemod that moved 1,543 strings in had no way to keep a sentence with a
 * number in the middle of it whole, because `translate` took a key and nothing
 * else. It split them instead, and a translator handed the piece "at" has no
 * way to know what it attaches to, let alone where their own language puts it.
 */
describe("a message that carries a value", () => {
  const catalogue = {
    "test.plain": "Nothing to fill in.",
    "test.one": "Published with {count} objectives.",
    "test.two": "{champion} champions it, {reviewer} reviews it.",
    "test.twice": "{name} and {name} again.",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the point of this entry is that a message describing a template literal is not a message with a hole in it, and substitution has to leave it alone.
    "test.braces": "Use ${a} in a template, not a placeholder.",
  };

  test("substitutes a named value wherever the message puts it", () => {
    expect(translate(catalogue, "test.one", { count: 4 })).toBe(
      "Published with 4 objectives.",
    );
    expect(
      translate(catalogue, "test.two", { champion: "Priya", reviewer: "Sam" }),
    ).toBe("Priya champions it, Sam reviews it.");
  });

  test("fills every occurrence, because a language may need the name twice", () => {
    expect(translate(catalogue, "test.twice", { name: "Ada" })).toBe(
      "Ada and Ada again.",
    );
  });

  test("fails rather than rendering the placeholder when a value is missing", () => {
    // The whole point. A message that rendered "Published with {count}
    // objectives." would reach a screen looking almost right.
    expect(() => translate(catalogue, "test.one")).toThrow(/count/);
    expect(() => translate(catalogue, "test.two", { champion: "P" })).toThrow(
      /reviewer/,
    );
  });

  test("fails on a value the message does not use, which is a renamed hole", () => {
    expect(() =>
      translate(catalogue, "test.one", { count: 1, extra: "x" }),
    ).toThrow(/extra/);
  });

  test("leaves a message with no holes exactly as it is", () => {
    expect(translate(catalogue, "test.plain")).toBe("Nothing to fill in.");
    expect(translate(catalogue, "test.braces")).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: as above.
      "Use ${a} in a template, not a placeholder.",
    );
  });

  test("the pseudo locale keeps the hole, so a value can still be put in it", () => {
    const pseudo = buildPseudoCatalogue(catalogue);
    // Accenting `{count}` into `{cöünt}` would make every parameterised
    // message throw under the build check that exists to find defects.
    expect(pseudo["test.one"]).toContain("{count}");
    expect(translate(pseudo, "test.one", { count: 9 })).toContain("9");
  });

  test("every English message's holes are named, and Bahasa Melayu has the same ones", () => {
    for (const [key, value] of Object.entries(CATALOGUES.en)) {
      // Through the module's own definition of a hole, so a test and the
      // substitution cannot disagree about what one is.
      const source = [...messageHoles(value)].sort();
      const target = [...messageHoles(CATALOGUES.ms[key] ?? "")].sort();
      // A translation that dropped a hole renders a sentence with a gap in it,
      // and one that invented a hole throws at the reader.
      expect([key, target]).toEqual([key, source]);
    }
  });
});

describe("the pseudo-locale build check (UIUX-PLAN.md §8)", () => {
  test("every pseudo value is wrapped and longer than its source", () => {
    for (const value of Object.values(CATALOGUES.en)) {
      const pseudo = toPseudoLocale(value);
      expect(pseudo.startsWith("[")).toBe(true);
      expect(pseudo.endsWith("]")).toBe(true);
      expect(pseudo.length).toBeGreaterThan(value.length);
    }
  });

  test("findUnwrappedText sees nothing wrong in a fully-wrapped pseudo string", () => {
    expect(findUnwrappedText("[Ŝëäŕçh~~~]")).toEqual([]);
  });

  test("findUnwrappedText catches a hardcoded string sitting outside the wrapping", () => {
    expect(findUnwrappedText("[Ŝëäŕçh~~~] Hardcoded")).toEqual(["Hardcoded"]);
  });

  function Localized() {
    const { t } = useTranslations();
    return <span>{t("shell.shortcuts.close")}</span>;
  }

  function Unlocalized() {
    return <span>Close</span>;
  }

  test("a component that sources its text from the catalogue passes under the pseudo locale", () => {
    const pseudoCatalogue = buildPseudoCatalogue();
    const { container } = render(
      <TranslationsProvider locale="en" catalogueOverride={pseudoCatalogue}>
        <Localized />
      </TranslationsProvider>,
    );
    expect(findUnwrappedText(container.textContent ?? "")).toEqual([]);
  });

  test("a component with a hardcoded string is caught under the pseudo locale — the exact defect §8's CI check exists for", () => {
    const { container } = render(<Unlocalized />);
    expect(findUnwrappedText(container.textContent ?? "")).toEqual(["Close"]);
  });
});
