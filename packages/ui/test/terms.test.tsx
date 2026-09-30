import { TERM_KEYS, TERMINOLOGY } from "@openokr/method";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  buildPseudoCatalogue,
  CATALOGUES,
  findUnwrappedText,
  messageHoles,
  translate,
} from "../src/i18n/catalogue.ts";
import {
  inRunningText,
  isTermHole,
  renamedTerms,
  termHoleName,
} from "../src/i18n/terms.ts";
import {
  TranslationsProvider,
  useTranslations,
} from "../src/i18n/use-translations.tsx";

/**
 * The method's terms as holes in the catalogue (completeness review M-14).
 *
 * A workspace could rename "Objective" to "Ambition" on the rhythm card, the
 * rename was stored and resolved, and every screen still said "Objective",
 * because the word was written into each catalogue string. A string that
 * names a term now says so with a hole, and `translate` fills it with the
 * workspace's word or the catalogue's own.
 */

const AMBITION = {
  objective: { singular: "Ambition", plural: "Ambitions" },
} as const;

describe("every term has its own word in each language", () => {
  test("English is the method's canon, word for word", () => {
    for (const term of TERM_KEYS) {
      expect(CATALOGUES.en[`term.${term}.singular`]).toBe(
        TERMINOLOGY[term].singular,
      );
      expect(CATALOGUES.en[`term.${term}.plural`]).toBe(
        TERMINOLOGY[term].plural,
      );
    }
  });

  test("Bahasa Melayu has a word for every term", () => {
    for (const term of TERM_KEYS) {
      expect(CATALOGUES.ms[`term.${term}.singular`]).toBeTruthy();
      expect(CATALOGUES.ms[`term.${term}.plural`]).toBeTruthy();
    }
  });

  test("no message names a term hole the method does not define", () => {
    // A typo such as {termObjectve} would otherwise be an ordinary hole that
    // every caller is suddenly required to fill.
    for (const locale of ["en", "ms"] as const) {
      for (const [key, message] of Object.entries(CATALOGUES[locale])) {
        for (const hole of messageHoles(message)) {
          if (/^term[A-Z]/.test(hole)) {
            expect([locale, key, hole, isTermHole(hole)]).toEqual([
              locale,
              key,
              hole,
              true,
            ]);
          }
        }
      }
    }
  });
});

describe("a workspace that renamed nothing reads exactly what it read before", () => {
  // The English these keys held before they took a hole. A default install
  // must not move by a letter.
  test.each([
    ["cycle.drafting.addObjective", undefined, "Add objective"],
    ["cycle.drafting.addKeyResult", undefined, "Add key result"],
    ["spaces.spaces", undefined, "Spaces"],
    ["common.count", undefined, "KPIs"],
    ["cycle.admin.title", undefined, "Cycles"],
    ["cycle.noCycleYet", undefined, "No cycle yet"],
    ["goals.noGoalsInThisCycleYet", undefined, "No goals in this cycle yet"],
    ["goals.detail.keyResults", { length: 3 }, "Key results (3)"],
    ["common.count.objectiveOther", { count: 4 }, "4 objectives"],
    ["common.count.keyResultOne", { count: 1 }, "1 key result"],
    ["common.kpis", { length: 2 }, "2 KPIs"],
    ["checkIn.timeline.checkInHistory", undefined, "Check-in history"],
    ["kpis.trees.kpiTrees", undefined, "KPI trees"],
    [
      "segmentError.checkIn",
      undefined,
      "We could not load the check-in composer",
    ],
    ["common.champion", undefined, "Champion"],
    ["workMap.keyResult", undefined, "key result"],
  ] as const)("%s", (key, values, expected) => {
    expect(translate(CATALOGUES.en, key, values)).toBe(expected);
    expect(translate(CATALOGUES.en, key, values, {})).toBe(expected);
  });

  test("and Bahasa Melayu reads its own words, not the English canon", () => {
    expect(translate(CATALOGUES.ms, "cycle.drafting.addObjective")).toBe(
      "Tambah objektif",
    );
    expect(translate(CATALOGUES.ms, "cycle.drafting.addKeyResult")).toBe(
      "Tambah keputusan utama",
    );
    expect(translate(CATALOGUES.ms, "spaces.spaces")).toBe("Ruang");
    expect(translate(CATALOGUES.ms, "cycle.noAnnualCycleYet")).toBe(
      "Belum ada kitaran tahunan",
    );
  });
});

describe("a renamed term follows into every message that holds it", () => {
  test("as a heading, in a sentence, and in a count", () => {
    expect(
      translate(CATALOGUES.en, "search.objectives", undefined, AMBITION),
    ).toBe("Ambitions");
    expect(
      translate(
        CATALOGUES.en,
        "cycle.drafting.addObjective",
        undefined,
        AMBITION,
      ),
    ).toBe("Add ambition");
    expect(
      translate(
        CATALOGUES.en,
        "common.count.objectiveOther",
        { count: 3 },
        AMBITION,
      ),
    ).toBe("3 ambitions");
  });

  test("keeps an acronym's capitals inside a sentence", () => {
    const renamed = { kpi: { singular: "OKR metric", plural: "OKR metrics" } };
    expect(translate(CATALOGUES.en, "kpis.addAKpi", undefined, renamed)).toBe(
      "New OKR metric",
    );
    expect(translate(CATALOGUES.en, "common.count", undefined, renamed)).toBe(
      "OKR metrics",
    );
  });

  test("raises a lower-case label where a heading needs it", () => {
    const renamed = { space: { singular: "team", plural: "teams" } };
    expect(translate(CATALOGUES.en, "spaces.spaces", undefined, renamed)).toBe(
      "Teams",
    );
    expect(
      translate(CATALOGUES.en, "spaces.createTheSpace", undefined, renamed),
    ).toBe("Create the team");
  });

  test("is the organisation's word in Bahasa Melayu too, because it holds one", () => {
    // The settings hold one pair of words and no second language. A rename is
    // the organisation's own name for the thing, not a translation of ours.
    expect(
      translate(
        CATALOGUES.ms,
        "cycle.drafting.addObjective",
        undefined,
        AMBITION,
      ),
    ).toBe("Tambah ambition");
  });

  test("leaves every other term in the catalogue's own words", () => {
    expect(
      translate(
        CATALOGUES.en,
        "cycle.drafting.addKeyResult",
        undefined,
        AMBITION,
      ),
    ).toBe("Add key result");
  });
});

describe("a term hole belongs to the catalogue, not to the caller", () => {
  test("needs no value", () => {
    expect(() => translate(CATALOGUES.en, "spaces.spaces")).not.toThrow();
  });

  test("refuses a value passed for one, as it would any hole it lacks", () => {
    const hole = termHoleName("space", "plural", "start");
    expect(hole).toBe("termSpaces");
    expect(() =>
      translate(CATALOGUES.en, "spaces.spaces", { [hole]: "Teams" }),
    ).toThrow(/no hole for termSpaces/);
  });

  test("names four holes per term", () => {
    expect(termHoleName("keyResult", "singular", "start")).toBe(
      "termKeyResult",
    );
    expect(termHoleName("keyResult", "plural", "running")).toBe(
      "termKeyResultsLower",
    );
    expect(isTermHole("termCheckInLower")).toBe(true);
    expect(isTermHole("termGoal")).toBe(false);
  });
});

describe("inRunningText", () => {
  test.each([
    ["Key result", "key result"],
    ["Check-in", "check-in"],
    ["KPI", "KPI"],
    ["OKR Goal", "OKR goal"],
    ["Big Rock", "big rock"],
    ["iOS", "iOS"],
    ["Keputusan utama", "keputusan utama"],
  ])("%s reads as %s inside a sentence", (label, expected) => {
    expect(inRunningText(label)).toBe(expected);
  });
});

describe("renamedTerms", () => {
  test("keeps only the terms that differ from the canon", () => {
    const resolved = Object.fromEntries(
      TERM_KEYS.map((term) => [
        term,
        {
          singular: TERMINOLOGY[term].singular,
          plural: TERMINOLOGY[term].plural,
        },
      ]),
    );
    expect(renamedTerms(resolved)).toEqual({});
    expect(renamedTerms({ ...resolved, ...AMBITION })).toEqual(AMBITION);
  });

  test("answers nothing for a value it cannot read", () => {
    expect(renamedTerms(null)).toEqual({});
    expect(renamedTerms("objective")).toEqual({});
    expect(renamedTerms({ goal: { singular: "x", plural: "y" } })).toEqual({});
  });
});

describe("in a component", () => {
  function AddObjective() {
    const { t } = useTranslations();
    return <button type="button">{t("cycle.drafting.addObjective")}</button>;
  }

  test("reads the rename the provider was handed", () => {
    const { container } = render(
      <TranslationsProvider locale="en" renamed={AMBITION}>
        <AddObjective />
      </TranslationsProvider>,
    );
    expect(container.textContent).toBe("Add ambition");
  });

  test("passes the pseudo-locale check with a term inside a message", () => {
    // The term is a wrapped catalogue entry inside another wrapped entry, so
    // the check has to strip wrappers from the inside out.
    const { container } = render(
      <TranslationsProvider
        locale="en"
        catalogueOverride={buildPseudoCatalogue()}
      >
        <AddObjective />
      </TranslationsProvider>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("[");
    expect(findUnwrappedText(text)).toEqual([]);
  });
});
