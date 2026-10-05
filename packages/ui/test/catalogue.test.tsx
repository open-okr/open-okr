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
import { isTermHole } from "../src/i18n/terms.ts";
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
  // The name of an API style, which the glossary keeps as it is.
  "account.apiTokens.audienceRest",
  // Code, commands, formats and example values a person types as shown.
  "activity.pnpmAuditVerify",
  "admin.ai.privacy.allowedHostsPlaceholder",
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
  // The shortcut itself, as the tour's last stop is named for it (L-08).
  "tour.search.title",
  // Abbreviations the method keeps in English in every language.
  "common.ai",
  "dev.components.ai",
  "term.kpi.singular",
  "workMap.kr",
  "okrDiagram.addKeyResult",
  "workMap.obj",
  // Words Bahasa Melayu uses as they are.
  "kpis.suggestion.unit",
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
  "copilot.copilotPanel.preview.cycle",
  "copilot.copilotPanel.preview.keyResult",
  "copilot.copilotPanel.preview.objective",
  "copilot.copilotPanel.preview.space",
  "goals.detail.decompose.refused",
  "admin.plan.planWithSeats",
  "board.board.movedTo",
  "checkIn.timeline.bylineDate",
  "checkIn.walkerLine",
  "cycle.actions.measureRefusedBecause",
  "documents.subjectDocuments.authorAndVersions",
  "initiatives.metaKeyResults",
  "initiatives.metaWindowKeyResults",
  "workMapHeader.scopeSummary",
  // Only a term, which each language fills with its own word or the
  // workspace's rename (M-14), sometimes beside a hole or a bracket.
  "board.scope.inSpace",
  "board.scope.ofObjective",
  "common.champion",
  "common.confidence",
  "common.count",
  "common.count.keyResultOne",
  "common.count.keyResultOther",
  "common.count.objectiveOne",
  "common.count.objectiveOther",
  "common.keyResult",
  "common.kpis",
  "common.reviewer",
  "cycle.admin.title",
  "cycle.reviewAndLearn.keyResults",
  "cycle.setup.facilitator",
  "cycle.setup.sponsor",
  "goals.detail.keyResults",
  "inbox.subject.checkIn",
  "inbox.subject.cycle",
  "inbox.subject.kpi",
  "inbox.subject.space",
  "initiatives.space",
  "kpis.grid.kpi",
  "scorecard.cycle",
  "search.checkIn",
  "search.checkIns",
  "search.cycle",
  "search.objective",
  "search.objectives",
  "search.space",
  "session.detail.minutes.objectives",
  "sessions.schedule.facilitator",
  "sessions.schedule.space",
  "spaces.spaces",
  "tour.checkIn.title",
  // Both are a line made only of holes and a slash: the workspace's own
  // words for the two things the column holds. Nothing to translate.
  "goals.editor.columnName",
  "workMap.goalKeyResult",
  "workMap.keyResult",
  "workMap.objective",
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
        comparableHoles(CATALOGUES.en[key] ?? "").join() !==
        comparableHoles(CATALOGUES.ms[key] ?? "").join(),
    );
    expect(mismatched).toEqual([]);
  });
});

/**
 * A message's holes, with a term hole named for its term and number alone
 * (M-14).
 *
 * Whether a term starts the sentence or sits inside it is the translator's
 * call, because word order is the language's: "Check-in history" and "Sejarah
 * kemas kini" hold the same term, first in one and last in the other. Which
 * term, and in which number, is not a choice, so that half is still compared.
 */
function comparableHoles(message: string): readonly string[] {
  return [
    ...new Set(
      messageHoles(message).map((hole) =>
        isTermHole(hole) ? hole.replace(/Lower$/, "") : hole,
      ),
    ),
  ].sort();
}

/**
 * A catalogue string names the instance, not the software (completeness review
 * M-33).
 *
 * "OpenOKR" was written into the sign-in heading, the setup heading, the root
 * error page, the chat linking prompt and the feed's name for the product
 * acting, so an instance its operator had named still said "OpenOKR" on every
 * one of them. Those strings take `{instanceName}` now.
 *
 * The word may stay only where it names the software or the company that runs
 * the managed cloud rather than this instance: the support session, which is
 * the cloud operator entering a customer's workspace, and a line describing
 * what the software speaks. This list is exactly the catalogue half of the
 * finding's "should keep OpenOKR" table, and adding to it is a decision about
 * whose name a screen shows.
 */
const NAMES_THE_SOFTWARE: ReadonlySet<string> = new Set([
  // The operator of the managed cloud, not the customer's instance.
  "admin.support.intro",
  "admin.support.nobodyHasBeen",
  "lib.supportBanner.supportIsHere",
  // What the software speaks, whatever the instance is called.
  "admin.sso.connectAnIdentityProvider",
]);

describe("the instance's name is not written into the catalogue (M-33)", () => {
  test("no entry says OpenOKR unless it names the software", () => {
    for (const locale of ["en", "ms"] as const) {
      const branded = Object.entries(CATALOGUES[locale])
        .filter(([, value]) => value.includes("OpenOKR"))
        .map(([key]) => key)
        .filter((key) => !NAMES_THE_SOFTWARE.has(key));
      expect([locale, branded]).toEqual([locale, []]);
    }
  });

  test("every entry on the list still names the software", () => {
    const stale = [...NAMES_THE_SOFTWARE].filter(
      (key) => !(CATALOGUES.en[key] ?? "").includes("OpenOKR"),
    );
    expect(stale).toEqual([]);
  });

  test("the strings that name the instance carry the hole in both languages", () => {
    for (const key of [
      "auth.signIn.heading",
      "setup.heading",
      "globalError.couldNotStart",
      "account.channels.actions.sendThisToTheBot",
    ]) {
      for (const locale of ["en", "ms"] as const) {
        const holes = messageHoles(CATALOGUES[locale][key] ?? "");
        expect([locale, key, holes.includes("instanceName")]).toEqual([
          locale,
          key,
          true,
        ]);
      }
    }
    expect(
      translate(CATALOGUES.en, "auth.signIn.heading", {
        instanceName: "OKR Goal",
      }),
    ).toBe("Sign in to OKR Goal");
    expect(
      translate(CATALOGUES.ms, "auth.signIn.heading", {
        instanceName: "OKR Goal",
      }),
    ).toBe("Log masuk ke OKR Goal");
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
      const source = comparableHoles(value);
      const target = comparableHoles(CATALOGUES.ms[key] ?? "");
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
