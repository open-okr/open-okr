import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ASSIST_FEATURE_KEYS,
  REVIEW_ASSIST_KEYS,
  RHYTHM_ASSIST_KEYS,
} from "@openokr/core";
import {
  KPI_FREQUENCIES,
  KPI_STATES,
  TRIGGER_CATALOGUE,
} from "@openokr/method";
import { CATALOGUES } from "@openokr/ui/catalogues";
import { describe, expect, test } from "vitest";
import {
  AGENT_LOG_KIND_NAME_KEYS,
  AGENT_RUN_STATUS_NAME_KEYS,
  ASSIST_NAME_KEYS,
  AUTONOMY_NAME_KEYS,
  CHANNEL_STATE_NAME_KEYS,
  GOAL_LEVEL_NAME_KEYS,
  INDICATOR_NAME_KEYS,
  KPI_FREQUENCY_NAME_KEYS,
  KPI_STATE_NAME_KEYS,
  KPI_TIER_NAME_KEYS,
  MESSAGE_STATUS_NAME_KEYS,
  PROMPT_NAME_KEYS,
  QUALITY_STATUS_NAME_KEYS,
  SCHEDULE_NAME_KEYS,
  SESSION_KIND_NAME_KEYS,
  SPACE_ROLE_NAME_KEYS,
  THRESHOLD_PART_NAME_KEYS,
  TRIGGER_NAME_KEYS,
  VERDICT_NAME_KEYS,
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
      ...Object.values(SESSION_KIND_NAME_KEYS),
      ...Object.values(KPI_FREQUENCY_NAME_KEYS),
      ...Object.values(KPI_STATE_NAME_KEYS),
      ...Object.values(INDICATOR_NAME_KEYS),
      ...Object.values(KPI_TIER_NAME_KEYS),
      ...Object.values(SPACE_ROLE_NAME_KEYS),
      ...Object.values(GOAL_LEVEL_NAME_KEYS),
      ...Object.values(VERDICT_NAME_KEYS),
      ...Object.values(AGENT_RUN_STATUS_NAME_KEYS),
      ...Object.values(AGENT_LOG_KIND_NAME_KEYS),
      ...Object.values(AUTONOMY_NAME_KEYS),
      ...Object.values(CHANNEL_STATE_NAME_KEYS),
      ...Object.values(MESSAGE_STATUS_NAME_KEYS),
      ...Object.values(QUALITY_STATUS_NAME_KEYS),
      ...Object.values(THRESHOLD_PART_NAME_KEYS),
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

/**
 * Stored values are named rather than printed (usability review D3). Counted
 * from the method, so a new frequency or state fails here first.
 */
describe("every stored KPI value has a name", () => {
  test("every frequency and every state", () => {
    expect(
      KPI_FREQUENCIES.filter(
        (one) => KPI_FREQUENCY_NAME_KEYS[one] === undefined,
      ),
    ).toEqual([]);
    expect(
      KPI_STATES.filter((one) => KPI_STATE_NAME_KEYS[one] === undefined),
    ).toEqual([]);
  });
});

/**
 * A nudge's headline is the rule's own name (completeness review H-12). The
 * channel message reads it from `packages/method`, which has no catalogue;
 * this page reads it from the catalogue, which can be translated. Kept equal
 * here, so an email and the nudge volume page never name one rule twice.
 */
describe("a trigger's name is the same in the method and the catalogue", () => {
  test("every English name matches the title the channel message uses", () => {
    const english = CATALOGUES.en as Record<string, string>;
    const drift = TRIGGER_CATALOGUE.filter(
      (entry) => english[TRIGGER_NAME_KEYS[entry.key] ?? ""] !== entry.title,
    ).map((entry) => entry.key);
    expect(drift).toEqual([]);
  });
});

/**
 * R1 D8: stored codes were printed as the badge text. Each screen below now
 * names the value through a map. Read raw, because `readScreen` would resolve
 * a `t("key")` back to English and hide a code printed as it is stored.
 */
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("stored codes are named on the screens that printed them", () => {
  const sites: ReadonlyArray<
    readonly [string, readonly string[], readonly string[]]
  > = [
    ["../app/spaces/page.tsx", ["SPACE_ROLE_NAME_KEYS"], ["{space.ownRole}"]],
    [
      "../app/kpis/[id]/page.tsx",
      [
        "KPI_STATE_NAME_KEYS",
        "KPI_FREQUENCY_NAME_KEYS",
        "INDICATOR_NAME_KEYS",
        "KPI_TIER_NAME_KEYS",
      ],
      [
        "{kpi.state}",
        "\n                kpi.frequency,\n",
        "{child.indicatorType}",
      ],
    ],
    [
      "../app/people/[id]/page.tsx",
      ["healthWord"],
      ['goal.health.replace(/_/g, " ")'],
    ],
    [
      "../app/method/[id]/page.tsx",
      ["QUALITY_STATUS_NAME_KEYS"],
      ["{row.status}"],
    ],
    [
      "../app/admin/agents/page.tsx",
      [
        "AUTONOMY_NAME_KEYS",
        "AGENT_RUN_STATUS_NAME_KEYS",
        "AGENT_LOG_KIND_NAME_KEYS",
      ],
      [
        ">{agent.autonomy}<",
        "\n                        {run.status}\n",
        "\n                            {entry.kind}\n",
      ],
    ],
    [
      "../app/admin/channels/page.tsx",
      [
        "CHANNEL_STATE_NAME_KEYS",
        "MESSAGE_STATUS_NAME_KEYS",
        "CHANNEL_NAME_KEYS",
      ],
      ["{connection.state}", "{message.status}", ">{message.provider}<"],
    ],
    [
      "../app/admin/rhythm/rhythm-form.tsx",
      ["THRESHOLD_PART_NAME_KEYS"],
      ["label={part}"],
    ],
    [
      "../app/goals/[id]/page.tsx",
      ["GOAL_LEVEL_NAME_KEYS"],
      ["level: goal.level,"],
    ],
    [
      "../app/goals/[id]/rail.tsx",
      ["GOAL_LEVEL_NAME_KEYS"],
      ["{relations.parent.level}", "{child.level} "],
    ],
    [
      "../app/goals/okr-diagram-cards.tsx",
      ["GOAL_LEVEL_NAME_KEYS"],
      ["{goal.level}"],
    ],
    ["../app/goals/okr-drawer.tsx", ["GOAL_LEVEL_NAME_KEYS"], ["{goal.level}"]],
    [
      "../app/check-in/page.tsx",
      ["GOAL_LEVEL_NAME_KEYS"],
      ["level: goal.level,"],
    ],
  ];

  for (const [path, names, raw] of sites) {
    test(path, () => {
      const text = source(path);
      for (const name of names) {
        expect(text, `${name} is used`).toContain(name);
      }
      for (const code of raw) {
        expect(text, `${code} is printed raw`).not.toContain(code);
      }
    });
  }

  test("the verdict label is named, not printed", () => {
    const text = source("../lib/verdict.ts");
    expect(text).toContain("VERDICT_NAME_KEYS");
    expect(text).not.toContain('"not scored"');
  });
});
