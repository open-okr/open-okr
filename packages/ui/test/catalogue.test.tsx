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
 * Bahasa Melayu is translated, not stubbed (completeness review M-15).
 *
 * 1,494 of 1,578 Malay entries were the English copied across, and the only
 * check was that the keys existed. An entry may read the same in both only for
 * a reason written here: a name, a piece of code or an example, a word Malay
 * uses as it is, or a line made only of holes and punctuation. Anything else
 * identical to the English is an entry nobody translated.
 */
const SAME_IN_MALAY: ReadonlySet<string> = new Set([
  // Product, vendor and language names.
  "activity.openOkr",
  "feedPanel.openOkr",
  "method.detail.okrChampion",
  "method.detail.okrCoach",
  "admin.ai.providerAnthropic",
  "admin.ai.providerGoogle",
  "admin.ai.providerOllama",
  "admin.ai.providerOpenai",
  "admin.ai.providerOpenrouter",
  "admin.sso.oidc",
  "admin.sso.saml2",
  "admin.sso.ssoForm.oidcOpenIdConnect",
  "channels.slack",
  "channels.teams",
  "channels.telegram",
  "channels.whatsapp",
  "people.detail.profileForm.slack",
  "people.detail.profileForm.teams",
  "people.detail.profileForm.telegram",
  "people.detail.profileForm.whatsapp",
  "search.exportButton.csv",
  "search.exportButton.excel",
  "appearance.english",
  "appearance.bahasaMelayu",
  "copilot.copilotPanel.copilot",
  // Code, commands, formats and example values a person types as shown.
  "activity.pnpmAuditVerify",
  "admin.audit.actionPlaceholder",
  "admin.audit.targetTypePlaceholder",
  "admin.imports.exportCard.kb",
  "admin.imports.exportCard.sha",
  "admin.invitations.exampleComExampleOrg",
  "admin.sso.ssoForm.certificatePlaceholder",
  "admin.sso.ssoForm.discoveryUrlPlaceholder",
  "admin.sso.ssoForm.emailDomainsPlaceholder",
  "admin.sso.ssoForm.issuerPlaceholder",
  "admin.sso.ssoForm.providerIdPlaceholder",
  "admin.sso.ssoForm.scopesPlaceholder",
  "admin.sso.ssoForm.signOnUrlPlaceholder",
  "admin.sso.ssoForm.urlPlaceholder",
  "common.esc",
  // Abbreviations the method keeps in English in every language.
  "common.ai",
  "dev.components.ai",
  "inbox.subject.kpi",
  "kpis.grid.kpi",
  "common.count.krOne",
  "workMap.kr",
  "workMap.obj",
  // Words Bahasa Melayu uses as they are.
  "admin.agents.levelEdit",
  "admin.agents.proposalQueue.itemsOne",
  "admin.ai.model",
  "admin.imports.import",
  "admin.imports.wizard.importRows",
  "checkIn.composer.status",
  "common.edit",
  "cycle.drafting.unit",
  "dev.components.neutral",
  "kpis.detail.formula",
  "lib.sectionTabs.grid",
  "people.detail.bio",
  "session.detail.quarterlyReview.actRetro",
  "sessions.schedule.kind",
  // Only holes and punctuation.
  "admin.plan.planWithSeats",
  "checkIn.timeline.bylineDate",
  "checkIn.walkerLine",
  "cycle.actions.measureRefusedBecause",
  "documents.subjectDocuments.authorAndVersions",
  "initiatives.metaKeyResults",
  "initiatives.metaWindowKeyResults",
  "workMapHeader.scopeSummary",
]);

describe("Bahasa Melayu is translated (completeness review M-15)", () => {
  test("no entry reads the same as the English without a written reason", () => {
    const untranslated = Object.entries(CATALOGUES.en)
      .filter(([key, english]) => CATALOGUES.ms[key] === english)
      .map(([key]) => key)
      .filter((key) => !SAME_IN_MALAY.has(key));
    expect(untranslated).toEqual([]);
  });

  test("every reason on the list still applies", () => {
    const stale = [...SAME_IN_MALAY].filter(
      (key) =>
        !(key in CATALOGUES.en) || CATALOGUES.ms[key] !== CATALOGUES.en[key],
    );
    expect(stale).toEqual([]);
  });

  test("every Malay entry has the holes its English one has", () => {
    const mismatched = Object.keys(CATALOGUES.en).filter(
      (key) =>
        [...messageHoles(CATALOGUES.en[key] ?? "")].sort().join() !==
        [...messageHoles(CATALOGUES.ms[key] ?? "")].sort().join(),
    );
    expect(mismatched).toEqual([]);
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
