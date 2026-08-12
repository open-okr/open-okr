import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  buildPseudoCatalogue,
  CATALOGUES,
  findUnwrappedText,
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
