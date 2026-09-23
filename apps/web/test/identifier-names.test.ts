import {
  ASSIST_FEATURE_KEYS,
  REVIEW_ASSIST_KEYS,
  RHYTHM_ASSIST_KEYS,
} from "@openokr/core";
import { TRIGGER_CATALOGUE } from "@openokr/method";
import { CATALOGUES } from "@openokr/ui";
import { describe, expect, test } from "vitest";
import {
  ASSIST_NAME_KEYS,
  PROMPT_NAME_KEYS,
  SCHEDULE_NAME_KEYS,
  TRIGGER_NAME_KEYS,
} from "../lib/identifier-names.ts";

/**
 * Every identifier a screen shows has a name (P8-G11d).
 *
 * **Four admin screens printed 67 dotted identifiers**, measured in a browser:
 * trigger keys, assist keys, prompt keys and run schedules. Agung's decision on
 * 23 September 2026 was that what is technical does not belong in the
 * interface.
 *
 * The maps fall back to the raw key, so a missing name leaves a legible row
 * rather than a blank one. That fallback is a safety net and not a supported
 * state, and this file is what makes the difference: a trigger added to the
 * method without a name here fails the build rather than reaching an instance.
 * The same guarantee `nav-icons.tsx` gets from the test that its map covers the
 * navigation registry.
 */

const en = CATALOGUES.en;

const ASSIST_KEYS = [
  ...Object.values(ASSIST_FEATURE_KEYS),
  ...Object.values(REVIEW_ASSIST_KEYS),
  ...Object.values(RHYTHM_ASSIST_KEYS),
];

describe("every identifier on an admin screen has a name", () => {
  test("every trigger the method defines", () => {
    // Counted from the method rather than from the map, so the map cannot pass
    // by being a subset of itself.
    const missing = TRIGGER_CATALOGUE.map((one) => one.key).filter(
      (key) => TRIGGER_NAME_KEYS[key] === undefined,
    );
    expect(missing).toEqual([]);
    expect(TRIGGER_CATALOGUE.length).toBeGreaterThan(40);
  });

  test("every assist that has a switch", () => {
    const missing = ASSIST_KEYS.filter(
      (key) => ASSIST_NAME_KEYS[key] === undefined,
    );
    expect(missing).toEqual([]);
  });

  test("no name points at a catalogue key that does not exist", () => {
    // The other direction. A name that resolves to nothing renders the key
    // back, which would look exactly like having no name at all.
    const all = [
      ...Object.values(TRIGGER_NAME_KEYS),
      ...Object.values(ASSIST_NAME_KEYS),
      ...Object.values(SCHEDULE_NAME_KEYS),
      ...Object.values(PROMPT_NAME_KEYS),
    ];
    const unresolved = all.filter((key) => en[key] === undefined);
    expect(unresolved).toEqual([]);
  });

  test("no map carries a name for an identifier that no longer exists", () => {
    // A stale entry is a translation nobody sees, which is the same defect the
    // catalogue's own orphan rule exists for.
    const triggers = new Set(TRIGGER_CATALOGUE.map((one) => one.key));
    expect(
      Object.keys(TRIGGER_NAME_KEYS).filter((key) => !triggers.has(key)),
    ).toEqual([]);

    // Typed as a set of strings, because the key maps are literal unions and
    // the point of this check is to catch a key that is no longer one of them.
    const assists = new Set<string>(ASSIST_KEYS);
    expect(
      Object.keys(ASSIST_NAME_KEYS).filter((key) => !assists.has(key)),
    ).toEqual([]);
  });
});
