import { describe, expect, test } from "vitest";
import {
  checkCatalogues,
  checkEnglishCopies,
  checkHoles,
  checkKeys,
  checkLedger,
  checkPlurals,
  checkReasons,
  checkScripts,
  syncCatalogue,
} from "../src/i18n/check.ts";

describe("i18n check suite (languages §6.2)", () => {
  const source = {
    greeting: "Hello, {name}!",
    "items.one": "{count} item",
    "items.other": "{count} items",
    "common.cancel": "Cancel",
  };

  test("row 1: Keys - fails when target lacks a key or has an extra key", () => {
    const targetMissing = {
      greeting: "Halo, {name}!",
    };
    const issuesMissing = checkKeys(
      "ms",
      Object.keys(source),
      Object.keys(targetMissing),
    );
    expect(issuesMissing.length).toBeGreaterThan(0);
    expect(issuesMissing.some((i) => i.message.includes("common.cancel"))).toBe(
      true,
    );

    const targetExtra = {
      ...source,
      "stale.key": "Stale",
    };
    const issuesExtra = checkKeys(
      "ms",
      Object.keys(source),
      Object.keys(targetExtra),
    );
    expect(issuesExtra.length).toBeGreaterThan(0);
    expect(issuesExtra.some((i) => i.message.includes("stale.key"))).toBe(true);
  });

  test("row 2: Holes - fails when a value's named holes differ from English (AC-8)", () => {
    const targetBroken = {
      ...source,
      greeting: "Halo, {wrong}!",
    };
    const issues = checkHoles("ms", source, targetBroken);
    expect(issues.length).toBe(1);
    expect(issues[0]?.key).toBe("greeting");
    expect(issues[0]?.check).toBe("holes");
  });

  test("row 3: Plurals - fails when a base key lacks a category its locale needs (AC-8)", () => {
    // ar needs zero, one, two, few, many, other
    const targetArMissing = {
      ...source,
      "items.other": "{count} عنصر",
    };
    const issues = checkPlurals("ar", "ar-u-nu-latn", source, targetArMissing);
    expect(issues.length).toBeGreaterThan(0);
    expect(
      issues.some((i) => i.key === "items" && i.message.includes("zero")),
    ).toBe(true);
  });

  test("row 4: English copies - fails when a value equals English and is listed nowhere (AC-9)", () => {
    const targetWithCopy = {
      greeting: "Hallo, {name}!",
      "items.one": "{count} Element",
      "items.other": "{count} Elemente",
      "common.cancel": "Cancel",
    };
    const issues = checkEnglishCopies("de", source, targetWithCopy, {}, []);
    expect(issues.length).toBe(1);
    expect(issues[0]?.key).toBe("common.cancel");
    expect(issues[0]?.check).toBe("english-copies");

    // Passes when in sameAsEnglish
    const issuesAllowed = checkEnglishCopies(
      "de",
      source,
      targetWithCopy,
      { "common.cancel": "Loanword in German" },
      [],
    );
    expect(issuesAllowed).toEqual([]);

    // Passes when in pending
    const issuesPending = checkEnglishCopies("de", source, targetWithCopy, {}, [
      "common.cancel",
    ]);
    expect(issuesPending).toEqual([]);
  });

  test("row 5: Ledger - fails when pending entry does not exist or value differs from English", () => {
    const targetTranslated = {
      ...source,
      "common.cancel": "Batal",
    };
    // pending has "common.cancel" but target is already translated!
    const issues = checkLedger("ms", source, targetTranslated, [
      "common.cancel",
      "nonexistent.key",
    ]);
    expect(issues.length).toBe(2);
    expect(issues[0]?.check).toBe("ledger");
    expect(issues[1]?.check).toBe("ledger");
  });

  test("row 6: Reasons - fails when same-as-english has empty reason or value differs from English", () => {
    const targetDiffers = {
      ...source,
      "common.cancel": "Batal",
    };
    const issues = checkReasons("ms", source, targetDiffers, {
      "common.cancel": "Should match English but differs",
      greeting: "   ", // empty reason
    });
    expect(issues.length).toBe(2);
    expect(issues[0]?.check).toBe("reasons");
    expect(issues[1]?.check).toBe("reasons");
  });

  test("row 7: Scripts - fails when zh-Hans lacks Han or ar lacks Arabic unless in same-as-english", () => {
    const zhCatalogue = {
      greeting: "Hello, {name}!", // No Han character
      "items.one": "{count} 个项目",
      "items.other": "{count} 个项目",
      "common.cancel": "取消",
    };
    const issuesZh = checkScripts("zh-Hans", zhCatalogue, {});
    expect(issuesZh.length).toBe(1);
    expect(issuesZh[0]?.key).toBe("greeting");
    expect(issuesZh[0]?.check).toBe("scripts");

    const arCatalogue = {
      greeting: "Hello, {name}!", // No Arabic character
      "items.one": "عنصر واحد",
      "items.other": "{count} عنصر",
      "common.cancel": "إلغاء",
    };
    const issuesAr = checkScripts("ar", arCatalogue, {});
    expect(issuesAr.length).toBe(1);
    expect(issuesAr[0]?.key).toBe("greeting");
    expect(issuesAr[0]?.check).toBe("scripts");
  });

  test("release gate: fails when pending is not empty under --release (AC-7)", () => {
    const catalogues = {
      ms: { ...source },
    };
    const pending = {
      ms: ["greeting"],
    };
    const issues = checkCatalogues(source, catalogues, { ms: {} }, pending, {
      release: true,
    });
    expect(issues.some((i) => i.check === "release")).toBe(true);
  });

  test("syncCatalogues: copies new English keys to target and records in pending, removes deleted keys (AC-7)", () => {
    const currentTarget = {
      greeting: "Halo, {name}!",
      oldKey: "Lama",
    };
    const currentPending: string[] = [];

    const { updatedTarget, updatedPending, added, removed } = syncCatalogue(
      "ms",
      source,
      currentTarget,
      currentPending,
    );

    expect(added).toContain("items.one");
    expect(added).toContain("items.other");
    expect(added).toContain("common.cancel");
    expect(removed).toContain("oldKey");
    expect(updatedTarget["items.one"]).toBe("{count} item");
    expect(updatedTarget.oldKey).toBeUndefined();
    expect(updatedPending).toContain("items.one");
    expect(updatedPending).toContain("items.other");
    expect(updatedPending).toContain("common.cancel");
    expect(updatedPending).not.toContain("greeting");
  });
});
