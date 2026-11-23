import { describe, expect, test } from "vitest";
import { messageHoles } from "../src/i18n/catalogue.ts";
import { CATALOGUES } from "../src/i18n/catalogues.ts";
import { isTermHole } from "../src/i18n/terms.ts";

describe("plural keys check", () => {
  test("no key ends in One, Other or Many with a sibling of another of those suffixes", () => {
    const en = CATALOGUES.en;
    const keys = Object.keys(en);
    const violations: string[] = [];

    for (const key of keys) {
      if (key.endsWith("One")) {
        const base = key.slice(0, -3);
        if (keys.includes(`${base}Other`) || keys.includes(`${base}Many`)) {
          violations.push(key);
        }
      } else if (key.endsWith("Other")) {
        const base = key.slice(0, -5);
        if (keys.includes(`${base}One`) || keys.includes(`${base}Many`)) {
          violations.push(key);
        }
      } else if (key.endsWith("Many")) {
        const base = key.slice(0, -4);
        if (keys.includes(`${base}One`) || keys.includes(`${base}Other`)) {
          violations.push(key);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("every category carries the same holes as other except {count} in one", () => {
    const en = CATALOGUES.en;
    const keys = Object.keys(en);
    const categoryKeys = [".zero", ".one", ".two", ".few", ".many"];
    const baseKeysWithOther = keys
      .filter((k) => k.endsWith(".other"))
      .map((k) => k.slice(0, -6));

    const mismatchedHoles: string[] = [];

    for (const base of baseKeysWithOther) {
      const otherHoles = messageHoles(en[`${base}.other`] ?? "").filter(
        (h) => h !== "count" && !isTermHole(h),
      );
      for (const cat of categoryKeys) {
        const fullKey = `${base}${cat}`;
        if (fullKey in en) {
          const holes = messageHoles(en[fullKey] ?? "").filter(
            (h) => h !== "count" && !isTermHole(h),
          );
          if (holes.sort().join(",") !== otherHoles.sort().join(",")) {
            mismatchedHoles.push(
              `${fullKey}: expected [${otherHoles.join(",")}], got [${holes.join(",")}]`,
            );
          }
        }
      }
    }

    expect(mismatchedHoles).toEqual([]);
  });
});
