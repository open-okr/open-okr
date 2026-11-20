"use client";

import type { callAction } from "@openokr/core";
import { isTermKey, suggestedTerm } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  MethodHint,
  NumberInput,
  SelectInput,
  SettingsSaveBar,
  TextInput,
  TokenInput,
  useKeyboardRegistry,
  useSubmitShortcut,
  useTranslations,
  useUnsavedGuard,
} from "@openokr/ui";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import {
  createContext,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { checkInFrequencyOptions } from "./check-in-options.ts";
import { saveRhythm } from "./rhythm-actions.ts";
import {
  changedFields,
  type FieldValue,
  NOTHING_SAVED,
  type RhythmState,
} from "./rhythm-state.ts";

/**
 * Editing the §11 registry for one workspace (P3-T02, widened at P6-G20).
 *
 * **Generated from the registry, so a threshold added to METHOD.md next month
 * appears here with no change to this file.** That was already true and is
 * what makes the rest of this worth doing.
 *
 * Three things P6-G20 changed.
 *
 * **A composite is editable.** Ladders, band sets, corridors and bounds pairs
 * are flat objects of numbers, and they rendered as `JSON.stringify` of the
 * resolved value with a note that no screen specified how to edit them. So
 * eighteen of the registry's parameters, including every escalation ladder and
 * every scoring band, could be read and not changed. One input per part, and
 * the whole set is written or none of it is.
 *
 * **A refusal is read.** The save caught `OperationError` and returned, so an
 * out-of-range value looked exactly like a successful save: the page came back
 * unchanged and said nothing at all. `rhythm.update` names the key and the
 * bound; that sentence now lands under the field it is about and in the bar.
 *
 * **A card returns to the canon.** "Reset to defaults" blanks the card's
 * fields, which the save then sends as nulls rather than as the canon's
 * current numbers. That is the difference between having no opinion and
 * having chosen today's default and keeping it after the canon moves.
 *
 * **One form, one sticky save bar** (docs/design/settings-page-layout.md,
 * "long page, one settings object"). The page used to save per card, with a
 * sticky header and a toast each. It is now one object: one Save sends every
 * card at once and is refused as a whole, and the bar names the cards that
 * changed. Every field is controlled, so Discard and Reset are plain state.
 *
 * Still read-only: the built-in words of the six §11 word lists. A workspace
 * may add terms and may not take the method's away.
 */

type Rhythm = Awaited<ReturnType<typeof callAction<"rhythm.read">>>;
type RegistryEntry = Rhythm["registry"][number];

/** The id of the page's one form, which the save bar's buttons act on. */
const FORM_ID = "rhythm-form";

/** One threshold's hint, worked out on the server by the page. */
export interface ThresholdHint {
  readonly why: string;
  /** The METHOD.md section's heading, without its number. */
  readonly section: string | null;
  readonly href: string;
  /** The principles the reason cites by number, each with its title. */
  readonly principles: readonly {
    readonly number: number;
    readonly title: string;
  }[];
}

/**
 * The "i" beside a threshold's name (UIUX-PLAN §4, method hint).
 *
 * **It does not repeat the reason the card already shows** under the name. It
 * says what that reason leans on: each principle it cites by number, with the
 * principle's title, and the part of the method the threshold comes from,
 * with a link to it. This puts back the pointer to the clause that P8-G11b
 * took away with the section chip, without the chip. A threshold whose reason
 * is not on the card, the two the check-in card shows as dropdowns, carries
 * its reason in the hint instead.
 */
function ThresholdHintButton({
  name,
  hint,
  withReason = false,
}: {
  readonly name: string;
  readonly hint: ThresholdHint | undefined;
  readonly withReason?: boolean;
}) {
  const { t } = useTranslations();
  if (hint === undefined) {
    return null;
  }
  return (
    <MethodHint name={name} href={hint.href}>
      <div className="flex flex-col gap-1">
        {withReason ? <p>{hint.why}</p> : null}
        {hint.principles.map((principle) => (
          <p key={principle.number}>
            {t("admin.rhythm.hint.principle", {
              number: String(principle.number),
              title: principle.title,
            })}
          </p>
        ))}
        {hint.section ? (
          <p className="text-ink-3">
            {t("admin.rhythm.hint.from", { section: hint.section })}
          </p>
        ) : null}
      </div>
    </MethodHint>
  );
}

/** Catalogue keys for each group's card title. */
const GROUP_TITLES: Record<string, string> = {
  cadence: "admin.rhythm.rhythmForm.groupCadence",
  scoring: "admin.rhythm.rhythmForm.groupScoring",
  quality: "admin.rhythm.rhythmForm.groupQuality",
  alignment: "goals.alignment",
  kpi: "admin.rhythm.rhythmForm.groupKpi",
  sessions: "common.sessions",
};

/** Catalogue keys for each group's one-line description under its title. */
const GROUP_DESCRIPTIONS: Record<string, string> = {
  cadence: "admin.rhythm.groupDescription.cadence",
  scoring: "admin.rhythm.groupDescription.scoring",
  quality: "admin.rhythm.groupDescription.quality",
  sessions: "admin.rhythm.groupDescription.sessions",
  alignment: "admin.rhythm.groupDescription.alignment",
  kpi: "admin.rhythm.groupDescription.kpi",
};

/**
 * The page's sections, in the order they read. A registry group this list
 * does not know is drawn at the end of "alignment", so a group added to §11
 * still appears.
 */
const SECTIONS = [
  {
    id: "rhythm",
    title: "admin.rhythm.section.rhythm.title",
    cards: ["check-in", "cadence", "sessions"],
  },
  {
    id: "scoring",
    title: "admin.rhythm.section.scoring.title",
    cards: ["scoring", "quality"],
  },
  {
    id: "alignment",
    title: "admin.rhythm.section.alignment.title",
    cards: ["alignment", "kpi"],
  },
  {
    id: "language",
    title: "admin.rhythm.section.language.title",
    cards: ["terminology"],
  },
] as const;

const WEEKDAYS = [
  [1, "sessions.schedule.weekday.monday"],
  [2, "sessions.schedule.weekday.tuesday"],
  [3, "sessions.schedule.weekday.wednesday"],
  [4, "sessions.schedule.weekday.thursday"],
  [5, "sessions.schedule.weekday.friday"],
  [6, "admin.rhythm.rhythmForm.saturday"],
  [7, "admin.rhythm.rhythmForm.sunday"],
] as const;

/**
 * A flat object whose every value is a number: a ladder, a band set, a pair.
 *
 * An array counts, and is reported as one, because §11 declares two of these
 * as `z.array` and reassembling those into an object would be refused by the
 * schema. `Object.entries` reads an array's indices as the part names, which
 * is exactly the order they go back in.
 */
function numericParts(
  value: unknown,
): ReadonlyArray<readonly [string, number]> | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const pairs = Object.entries(value as Record<string, unknown>);
  if (pairs.length === 0) {
    return null;
  }
  return pairs.every(([, part]) => typeof part === "number")
    ? (pairs as ReadonlyArray<readonly [string, number]>)
    : null;
}

/** A §11 word list as it is stored: named lists of terms. */
type WordListMap = Readonly<Record<string, readonly string[]>>;

/**
 * The value, if it is a map of named word lists.
 *
 * Narrow on purpose. Anything else still falls through to the `JSON.stringify`
 * line below, which is the right answer for a shape nobody has designed a
 * control for yet.
 */
function wordLists(value: unknown): WordListMap | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return null;
  }
  return entries.every(
    ([, terms]) =>
      Array.isArray(terms) && terms.every((one) => typeof one === "string"),
  )
    ? (value as WordListMap)
    : null;
}

/**
 * The fields one registry row draws, by the name the save reads each under,
 * with what this workspace has stored in each.
 *
 * One place for the names, so the initial values, a card's reset and the
 * unsaved list cannot disagree about which fields a row has. A scalar is
 * `threshold:<key>`, a composite's parts are `composite:<key>:<part>` and a
 * list's are `list:<key>:<part>`, a word list's are `words:<key>:<list>`.
 */
function entryFields(
  key: string,
  resolved: unknown,
  override: unknown,
): ReadonlyArray<readonly [string, FieldValue]> {
  const overrideParts =
    override && typeof override === "object"
      ? (override as Record<string, unknown>)
      : null;
  if (typeof resolved === "number") {
    return [
      [`threshold:${key}`, typeof override === "number" ? override : null],
    ];
  }
  const parts = numericParts(resolved);
  if (parts) {
    const prefix = Array.isArray(resolved) ? "list" : "composite";
    return parts.map(([part]) => {
      const stored = overrideParts?.[part];
      return [
        `${prefix}:${key}:${part}`,
        typeof stored === "number" ? stored : null,
      ];
    });
  }
  const words = wordLists(resolved);
  if (words) {
    return Object.keys(words).map((name) => {
      const ours = overrideParts?.[name];
      return [
        `words:${key}:${name}`,
        Array.isArray(ours) ? (ours as string[]) : [],
      ];
    });
  }
  return [];
}

/** A field left blank, which is how a card goes back to the canon. */
function blank(value: FieldValue): FieldValue {
  return Array.isArray(value) ? [] : null;
}

/** The page's field values, and how one is changed. */
interface Fields {
  readonly values: Readonly<Record<string, FieldValue>>;
  readonly set: (name: string, value: FieldValue) => void;
}

const FieldsContext = createContext<Fields>({ values: {}, set: () => {} });

/** The number a field holds, or null for a blank one. */
function numberAt(values: Fields["values"], name: string): number | null {
  const held = values[name];
  return typeof held === "number" ? held : null;
}

/** How many columns of a twelve-column row each part takes (up to four per row). */
const PART_SPANS: Record<number, string> = {
  12: "md:col-span-12",
  6: "md:col-span-6",
  4: "md:col-span-4",
  3: "md:col-span-3",
};

/** The span of each of `count` parts: rows of at most four, filled evenly. */
function partSpans(count: number): string[] {
  const rows = Math.ceil(count / 4);
  const spans: string[] = [];
  let left = count;
  for (let row = 0; row < rows; row++) {
    const inRow = Math.ceil(left / (rows - row));
    spans.push(...Array(inRow).fill(PART_SPANS[12 / inRow]));
    left -= inRow;
  }
  return spans;
}

/**
 * The six §11 quality word lists (P8-G08).
 *
 * **A workspace may add to them, and may not take from them (P8-G11b).**
 * That asymmetry is METHOD.md's, not this screen's: §11 words the parameter as
 * "a workspace may add terms; the canon terms remain", and
 * `resolveThresholds` merges rather than replaces for the reason its own
 * comment gives, which is that replacing would let a workspace switch a
 * quality rule off by storing an empty list. So the built-in terms are shown
 * and cannot be edited, and the box beside them holds this workspace's own.
 */
function WordLists({
  lists,
  entryKey,
  added,
  canManage,
}: {
  /** The resolved map: this workspace's terms already merged over the rest. */
  readonly lists: WordListMap;
  readonly entryKey: string;
  /** What this workspace stored, which is what the built-in terms exclude. */
  readonly added: Record<string, unknown> | null;
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const { values, set } = useContext(FieldsContext);
  return (
    <>
      {Object.entries(lists).map(([name, terms]) => {
        const field = `words:${entryKey}:${name}`;
        const held = values[field];
        const ours = Array.isArray(held) ? (held as readonly string[]) : [];
        const stored = Array.isArray(added?.[name])
          ? (added[name] as readonly string[])
          : [];
        const theirs = terms.filter((term) => !stored.includes(term));
        const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
        return (
          <div
            key={name}
            className="col-span-12 flex min-w-0 flex-col gap-1 md:col-span-6"
          >
            <span className="text-sm font-medium text-ink-2">
              {/* The registry's own camelCase key, spaced out. Renaming these
                  would mean renaming them in `packages/method`, and they are
                  the method's names rather than this screen's. */}
              {spaced}
              <span className="ms-1.5 font-normal text-ink-4">
                {theirs.length}
                {stored.length > 0 ? ` + ${stored.length}` : ""}
              </span>
            </span>
            {/* `wrap-break-word` because a single list is long and a term can
                be two words: without it the row sets the card's width and the
                whole page scrolls sideways. */}
            <p className="wrap-break-word text-xs text-ink-3">
              {theirs.join(", ")}
            </p>
            {/* A chip each, split on commas only, because a term can be two
                words (guided-inputs §4.11). Named with its list, where six
                boxes all answered to "Your own terms". */}
            <TokenInput
              label={t("admin.rhythm.rhythmForm.yourOwnTermsIn", {
                list: spaced,
              })}
              name={field}
              separators="commas"
              normalise={(term) => term.toLowerCase()}
              disabled={!canManage}
              value={ours}
              onValueChange={(next) => set(field, next)}
              placeholder={t("admin.rhythm.rhythmForm.noneAdded")}
            />
          </div>
        );
      })}
    </>
  );
}

/** One registry row: scalar, composite, or shown as it stands. */
function Parameter({
  entry,
  resolved,
  override,
  hint,
  canManage,
}: {
  readonly entry: RegistryEntry;
  readonly resolved: unknown;
  readonly override: unknown;
  readonly hint: ThresholdHint | undefined;
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const { values, set } = useContext(FieldsContext);

  // The refusal, if this is the parameter it was about (P8-G11a).
  const refused = useContext(RefusedContext);
  const refusal = refused?.key === entry.key ? refused.detail : null;
  const errorId = `rhythm-error-${entry.key}`;

  const parts = numericParts(resolved);
  const words = wordLists(resolved);
  // A list's fields carry a different prefix, so the save can put an array
  // back together as an array.
  const prefix = Array.isArray(resolved) ? "list" : "composite";
  const overrideParts =
    override && typeof override === "object"
      ? (override as Record<string, unknown>)
      : null;

  const heading = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-0.5">
          <span className="text-sm font-medium text-ink-2">{entry.label}</span>
          <ThresholdHintButton name={entry.label} hint={hint} />
        </span>
        <span className="flex items-center gap-2">
          {/*
           * **The METHOD §x chip is gone (P8-G11b).** Measured on this screen:
           * 53 of them, against 65 section references in the page's text, on
           * 13,560 characters. Agung's decision on 23 September 2026 was to
           * drop the chip and keep the sentence under each label, several of
           * which name their own section in passing. The cost is real and was
           * stated at the time: a parameter no longer carries a visible
           * pointer back to the clause it comes from.
           */}
          {override === undefined ? null : (
            <Chip tone="brand">{t("common.changed")}</Chip>
          )}
        </span>
      </div>
      <p className="text-xs text-ink-3">{entry.why}</p>
    </>
  );

  return (
    <div
      data-parameter={entry.key}
      className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0"
    >
      {typeof resolved === "number" ? (
        <>
          <div className="col-span-12 flex min-w-0 flex-col gap-1 md:col-span-8">
            {heading}
          </div>
          <div className="col-span-12 flex min-w-0 flex-col gap-1 md:col-span-4 md:self-end">
            {/* No min or max: the field would pull an out-of-range number back
                to the nearest bound without a word, where the server refuses
                it in words under the box (guided-inputs §6, 10c). */}
            <NumberInput
              label={entry.label}
              hideLabel
              name={`threshold:${entry.key}`}
              step={Number.isInteger(resolved) ? 1 : 0.01}
              disabled={!canManage}
              value={numberAt(values, `threshold:${entry.key}`)}
              onValueChange={(next) => set(`threshold:${entry.key}`, next)}
              placeholder={String(resolved)}
              invalid={refusal !== null}
              aria-describedby={refusal === null ? undefined : errorId}
            />
            <span className="text-xs text-ink-3">
              {t("admin.rhythm.rhythmForm.inForceLeaveBlankFor", {
                resolved: String(resolved),
              })}
            </span>
          </div>
        </>
      ) : parts ? (
        <>
          <div className="col-span-12 flex min-w-0 flex-col gap-1">
            {heading}
          </div>
          {parts.map(([part, inForce], index) => {
            const field = `${prefix}:${entry.key}:${part}`;
            return (
              <div
                key={part}
                className={`col-span-12 min-w-0 ${partSpans(parts.length)[index]}`}
              >
                <NumberInput
                  label={part}
                  name={field}
                  step={Number.isInteger(inForce) ? 1 : 0.01}
                  disabled={!canManage}
                  value={numberAt(values, field)}
                  onValueChange={(next) => set(field, next)}
                  placeholder={String(inForce)}
                  invalid={refusal !== null}
                  aria-describedby={refusal === null ? undefined : errorId}
                />
              </div>
            );
          })}
          <span className="col-span-12 text-xs text-ink-4">
            {t("admin.rhythm.rhythmForm.fillInEveryPart")}
          </span>
        </>
      ) : words ? (
        <>
          <div className="col-span-12 flex min-w-0 flex-col gap-1">
            {heading}
          </div>
          <WordLists
            lists={words}
            entryKey={entry.key}
            added={overrideParts as Record<string, unknown> | null}
            canManage={canManage}
          />
        </>
      ) : (
        <div className="col-span-12 flex min-w-0 flex-col gap-1">
          {heading}
          <p className="text-sm text-ink-3">
            {t("admin.rhythm.rhythmForm.inForce", {
              resolved: JSON.stringify(resolved),
            })}
            <span className="ms-1.5 text-ink-4">
              {t("admin.rhythm.rhythmForm.shownAsItStands")}
            </span>
          </p>
        </div>
      )}

      {/*
       * The method's own sentence, under the box it is about. Deliberately not
       * a live region: the bar carries the announcement, and two of them
       * would read one refusal out twice.
       */}
      {refusal === null ? null : (
        <p
          id={errorId}
          data-testid="rhythm-field-error"
          className="col-span-12 text-sm text-bad"
        >
          {refusal}
        </p>
      )}
    </div>
  );
}

/** A refusal, resolved to the parameter it is about. */
interface Refusal {
  /** A §11 registry key, e.g. `scoring.progressCeilingPct`. */
  readonly key: string;
  /** The half of the sentence after the key, for the line under the field. */
  readonly detail: string;
}

/**
 * The refusal's own message read back into a parameter key.
 *
 * **Both refusals this screen can produce already name the key**, and they
 * name it the same way: `rhythm.update` joins its problems as
 * `${key}: ${message}`, and the half-written-set refusal in `rhythm-actions`
 * is written to match. So the key is the text before the first colon, and
 * nothing new had to be carried back from the server to find it.
 *
 * Null when the sentence is about the page rather than a parameter. The bar
 * still shows it; there is simply no field to go to.
 */
function refusedParameter(message: string): Refusal | null {
  const split = message.indexOf(": ");
  if (split === -1) {
    return null;
  }
  const key = message.slice(0, split);
  // A registry key is `group.name`, with no spaces. Anything else is a
  // sentence that happens to contain a colon.
  return /^[a-z][a-zA-Z]*\.[a-zA-Z]+$/.test(key)
    ? { key, detail: message.slice(split + 2) }
    : null;
}

/** The parameter a refusal named, for the field that renders it. */
const RefusedContext = createContext<Refusal | null>(null);

/**
 * Brings the refused field into view and puts the caret in it.
 *
 * A parameter's row carries `data-parameter`, and its first visible input is
 * the field to go to: a number field posts through a hidden input of its own,
 * so the box a person types in is the first one that is not hidden.
 * `block: "center"` so the field is not left under the sticky bar.
 */
function focusRefused(
  element: HTMLFormElement | null,
  refusal: Refusal | null,
): void {
  if (element === null || refusal === null) {
    return;
  }
  const row = element.querySelector(
    `[data-parameter="${CSS.escape(refusal.key)}"]`,
  );
  const field = row?.querySelector<HTMLInputElement>(
    "input:not([type='hidden'])",
  );
  if (!field) {
    return;
  }
  field.scrollIntoView({ block: "center", behavior: "smooth" });
  field.focus({ preventScroll: true });
}

/** A card on the page's one form. It has no save of its own. */
function SettingsCard({
  id,
  title,
  description,
  action,
  children,
}: {
  /** The card's test id suffix. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  /** "Reset to defaults", for a group card. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card data-testid={`rhythm-card-${id}`}>
      <CardHeader className="flex-wrap items-start justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {description ? (
            <p className="text-xs text-ink-3">{description}</p>
          ) : null}
        </div>
        {action}
      </CardHeader>
      <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
        {children}
      </CardBody>
    </Card>
  );
}

/** The heading of a run of cards, with the tag that says they save together. */
function SectionHeading({ title, tag }: { title: string; tag: string }) {
  return (
    <h2 className="mt-2 -mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-ink-4 uppercase">
      {title}
      <span className="rounded-full bg-raised px-2 py-px text-[11px] font-semibold tracking-normal text-ink-3 normal-case">
        {tag}
      </span>
    </h2>
  );
}

export function RhythmForm({
  rhythm,
  hints,
  checkInHints,
  canManage,
}: {
  readonly rhythm: Rhythm;
  /** Each threshold's hint, keyed by threshold. */
  readonly hints: Readonly<Record<string, ThresholdHint>>;
  /** The check-in card's two dropdowns' hints, keyed by field. */
  readonly checkInHints: {
    readonly defaultCheckInFrequency: ThresholdHint | undefined;
    readonly checkInAnchorDay: ThresholdHint | undefined;
  };
  /**
   * `manage_coaching`, which `rhythm.update` requires as `full`.
   *
   * The server refuses either way and always will: the interface never hides
   * an authorisation. This says so instead of letting somebody fill the form
   * and meet the refusal on submit, which is the same permission read twice
   * for two different jobs.
   */
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const { register, unregister } = useKeyboardRegistry();
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    saveRhythm,
    NOTHING_SAVED,
  );
  // Said by the page itself when Save is pressed with nothing changed, which
  // sends nothing: a save of unchanged values would still write every field.
  const [notice, setNotice] = useState<string | null>(null);

  const rowsOf = useCallback(
    (group: string) =>
      rhythm.registry.filter(
        (entry) => entry.group === group && !entry.columnBacked,
      ),
    [rhythm.registry],
  );

  // Every field by the name the save reads it under, as stored: the
  // comparison for what is unsaved, and what Discard goes back to.
  const stored = useMemo(() => {
    const fields: Record<string, FieldValue> = {
      defaultCheckInFrequency: rhythm.defaultCheckInFrequency,
      checkInAnchorDay: String(rhythm.checkInAnchorDay),
    };
    for (const entry of rhythm.registry) {
      if (entry.columnBacked) {
        continue;
      }
      for (const [name, value] of entryFields(
        entry.key,
        rhythm.thresholds[entry.key],
        rhythm.overrides[entry.key],
      )) {
        fields[name] = value;
      }
    }
    for (const [term, label] of Object.entries(rhythm.terminology)) {
      const words = label as { singular: string; plural: string };
      fields[`label:${term}:singular`] = words.singular;
      fields[`label:${term}:plural`] = words.plural;
    }
    return fields;
  }, [rhythm]);
  const [values, setValues] = useState<Record<string, FieldValue>>(() => ({
    ...stored,
  }));
  const set = useCallback((name: string, value: FieldValue) => {
    setNotice(null);
    setValues((now) => ({ ...now, [name]: value }));
  }, []);
  const fields = useMemo<Fields>(() => ({ values, set }), [values, set]);

  const knownGroups = SECTIONS.flatMap((section) => section.cards);
  const extraGroups = [
    ...new Set(
      rhythm.registry
        .map((entry) => entry.group)
        .filter((group) => !knownGroups.some((known) => known === group)),
    ),
  ];
  const cardsOf = (section: (typeof SECTIONS)[number]): string[] => [
    ...section.cards,
    ...(section.id === "alignment" ? extraGroups : []),
  ];

  const groupTitle = (group: string) =>
    GROUP_TITLES[group] ? t(GROUP_TITLES[group]) : group;
  const cardTitle = (card: string): string =>
    card === "check-in"
      ? t("admin.rhythm.rhythmForm.theCheckInRhythm")
      : card === "terminology"
        ? t("admin.rhythm.rhythmForm.terminology")
        : groupTitle(card);
  // The fields each card holds, so the bar can name a card rather than listing
  // every parameter: sixty-odd fields do not fit a line.
  const fieldsOfCard = (card: string): string[] =>
    card === "check-in"
      ? ["defaultCheckInFrequency", "checkInAnchorDay"]
      : card === "terminology"
        ? Object.keys(stored).filter((name) => name.startsWith("label:"))
        : rowsOf(card).flatMap((entry) =>
            entryFields(
              entry.key,
              rhythm.thresholds[entry.key],
              rhythm.overrides[entry.key],
            ).map(([name]) => name),
          );

  const changed = new Set(changedFields(stored, values));
  const unsaved = SECTIONS.flatMap(cardsOf)
    .filter((card) => fieldsOfCard(card).some((name) => changed.has(name)))
    .map(cardTitle);
  const dirty = unsaved.length > 0;
  useUnsavedGuard("rhythm", dirty);
  const onKeyDown = useSubmitShortcut(canManage);

  // Which parameter the refusal is about, for the message under its own field.
  // Memoised on the sentence rather than recomputed, so the context value is
  // the same object between renders and the parameters are not all re-rendered
  // on every keystroke.
  const refused = useMemo<Refusal | null>(
    () => (state.error === null ? null : refusedParameter(state.error)),
    [state.error],
  );
  // **The refusal used to be invisible.** It sat at the top of a card that ran
  // to 1,700px. It is now in the bar, under the field the method named, and
  // the field is brought into view.
  const shown = useRef<RhythmState>(NOTHING_SAVED);
  useEffect(() => {
    if (shown.current === state) {
      return;
    }
    shown.current = state;
    if (state.error !== null) {
      focusRefused(form.current, refused);
    }
  }, [state, refused]);

  // Registered once for the page, which is one form.
  useEffect(() => {
    register({
      id: "form.save",
      keys: "⌘⏎",
      description: t("admin.rhythm.rhythmForm.saveTheCardShortcut"),
      group: "forms",
    });
    return () => unregister("form.save");
  }, [register, unregister, t]);

  // **Sent through a transition, not the form's own action**, because React
  // resets a form with an `action` as soon as that action resolves. For a
  // refusal that was wrong twice over: the value somebody typed was gone
  // before they had read why, and the message then described a number no
  // longer on screen. Nothing is reset, refused or saved.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty) {
      setNotice(t("common.noChanges"));
      return;
    }
    setNotice(null);
    const data = new FormData(
      event.currentTarget,
      (event.nativeEvent as SubmitEvent).submitter,
    );
    startTransition(() => formAction(data));
  };

  // "Reset to defaults": blanks the card's fields. A refill, not a write: the
  // change joins "Not saved yet", Discard undoes it, and the save sends each
  // blank as a null.
  const resetCard = (group: string) => {
    setNotice(null);
    setValues((now) => {
      const next = { ...now };
      for (const name of fieldsOfCard(group)) {
        next[name] = blank(now[name] ?? null);
      }
      return next;
    });
  };

  const groupCard = (group: string) => {
    const rows = rowsOf(group);
    if (rows.length === 0) {
      return null;
    }
    return (
      <SettingsCard
        key={group}
        id={group}
        title={groupTitle(group)}
        {...(GROUP_DESCRIPTIONS[group]
          ? { description: t(GROUP_DESCRIPTIONS[group]) }
          : {})}
        action={
          <Button
            type="button"
            size="sm"
            disabled={!canManage}
            onClick={() => resetCard(group)}
          >
            {t("common.resetToDefaults")}
          </Button>
        }
      >
        {rows.map((entry) => (
          <Parameter
            key={entry.key}
            entry={entry}
            resolved={rhythm.thresholds[entry.key]}
            override={rhythm.overrides[entry.key]}
            hint={hints[entry.key]}
            canManage={canManage}
          />
        ))}
      </SettingsCard>
    );
  };

  const checkInCard = (
    <SettingsCard
      key="check-in"
      id="check-in"
      title={t("admin.rhythm.rhythmForm.theCheckInRhythm")}
      description={t("admin.rhythm.rhythmForm.theseTwoHaveTheir")}
    >
      <div className="col-span-12 flex min-w-0 flex-col gap-1 md:col-span-6">
        {/* The hint sits beside the label rather than in it, so opening it
            does not move focus to the dropdown. */}
        <span className="flex items-start gap-0.5">
          <label
            htmlFor="rhythm-check-in-frequency"
            className="text-sm font-medium text-ink-2"
          >
            {t("admin.rhythm.rhythmForm.checkInFrequency")}
          </label>
          <ThresholdHintButton
            name={t("admin.rhythm.rhythmForm.checkInFrequency")}
            hint={checkInHints.defaultCheckInFrequency}
            withReason
          />
        </span>
        <SelectInput
          label={t("admin.rhythm.rhythmForm.checkInFrequency")}
          hideLabel
          id="rhythm-check-in-frequency"
          name="defaultCheckInFrequency"
          disabled={!canManage}
          value={String(values.defaultCheckInFrequency ?? "")}
          onChange={(event) =>
            set("defaultCheckInFrequency", event.currentTarget.value)
          }
        >
          {checkInFrequencyOptions(rhythm.defaultCheckInFrequency).map(
            (option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ),
          )}
        </SelectInput>
      </div>
      <div className="col-span-12 flex min-w-0 flex-col gap-1 md:col-span-6">
        <span className="flex items-start gap-0.5">
          <label
            htmlFor="rhythm-anchor-day"
            className="text-sm font-medium text-ink-2"
          >
            {t("admin.rhythm.rhythmForm.anchorDay")}
          </label>
          <ThresholdHintButton
            name={t("admin.rhythm.rhythmForm.anchorDay")}
            hint={checkInHints.checkInAnchorDay}
            withReason
          />
        </span>
        <SelectInput
          label={t("admin.rhythm.rhythmForm.anchorDay")}
          hideLabel
          id="rhythm-anchor-day"
          name="checkInAnchorDay"
          disabled={!canManage}
          value={String(values.checkInAnchorDay ?? "")}
          onChange={(event) =>
            set("checkInAnchorDay", event.currentTarget.value)
          }
        >
          {WEEKDAYS.map(([value, labelKey]) => (
            <option key={value} value={value}>
              {t(labelKey)}
            </option>
          ))}
        </SelectInput>
      </div>
      {/*
       * **Coach strictness left this card at P9-T05.** Every check now has
       * its own level (METHOD.md §4), and strict mode, which raises them
       * all to block, is one setting among the practice's. Two switches
       * for one behaviour is two places for an admin to look, and data
       * change 0015 carried every workspace that had chosen strict across.
       */}
      <p className="col-span-12 text-sm text-ink-3">
        {t("admin.rhythm.rhythmForm.strictModeIsOnThe")}{" "}
        <Link href="/admin/practice" className="text-brand-text underline">
          {t("admin.practice.title")}
        </Link>
      </p>
    </SettingsCard>
  );

  const terminologyCard = (
    <SettingsCard
      key="terminology"
      id="terminology"
      title={t("admin.rhythm.rhythmForm.terminology")}
      description={t("admin.rhythm.rhythmForm.renameAConceptThe")}
    >
      <div className="col-span-12 hidden grid-cols-12 gap-x-6 text-xs font-semibold text-ink-3 md:grid">
        <span className="col-span-4">
          {t("admin.rhythm.rhythmForm.termColumnConcept")}
        </span>
        <span className="col-span-4">
          {t("admin.rhythm.rhythmForm.termColumnSingular")}
        </span>
        <span className="col-span-4">
          {t("admin.rhythm.rhythmForm.termColumnPlural")}
        </span>
      </div>
      {Object.keys(rhythm.terminology).map((term, index) => {
        const singular = String(values[`label:${term}:singular`] ?? "");
        const suggested = isTermKey(term) ? suggestedTerm(term) : undefined;
        return (
          <div
            key={term}
            className={`col-span-12 grid grid-cols-12 gap-x-6 gap-y-3 border-line ${
              index === 0
                ? "border-t-0 pt-0 md:border-t md:pt-4"
                : "border-t pt-4"
            }`}
          >
            <div className="col-span-12 flex min-w-0 flex-col items-start gap-1.5 md:col-span-4 md:pt-1.5">
              <span className="text-sm text-ink-2">{term}</span>
              {suggested && canManage && singular !== suggested.singular ? (
                // METHOD.md's terms name a common alternative (D6, P9-T21).
                // Offered rather than applied: it fills both fields and the
                // page's own Save decides.
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    set(`label:${term}:singular`, suggested.singular);
                    set(`label:${term}:plural`, suggested.plural);
                  }}
                >
                  {t("admin.rhythm.rhythmForm.useSuggested", {
                    singular: suggested.singular,
                  })}
                </Button>
              ) : null}
            </div>
            {(["singular", "plural"] as const).map((shape) => (
              <div
                key={shape}
                className="col-span-12 flex min-w-0 flex-col gap-1 md:col-span-4"
              >
                {/* The column heading is not on a phone, where the rows
                    stack: this says which box is which. */}
                <span
                  aria-hidden="true"
                  className="text-xs font-semibold text-ink-3 md:hidden"
                >
                  {shape === "singular"
                    ? t("admin.rhythm.rhythmForm.termColumnSingular")
                    : t("admin.rhythm.rhythmForm.termColumnPlural")}
                </span>
                {/* Each named, where the two boxes had no label, and held
                    to the method's 40 (termLabelSchema). */}
                <TextInput
                  label={t(
                    shape === "singular"
                      ? "admin.rhythm.rhythmForm.termSingular"
                      : "admin.rhythm.rhythmForm.termPlural",
                    { term },
                  )}
                  hideLabel
                  name={`label:${term}:${shape}`}
                  maxLength={40}
                  disabled={!canManage}
                  value={String(values[`label:${term}:${shape}`] ?? "")}
                  onChange={(event) =>
                    set(`label:${term}:${shape}`, event.currentTarget.value)
                  }
                />
              </div>
            ))}
          </div>
        );
      })}
    </SettingsCard>
  );

  return (
    <FieldsContext.Provider value={fields}>
      <RefusedContext.Provider value={refused}>
        <div className="flex flex-col gap-4">
          {canManage ? null : (
            <Card>
              <CardBody>
                <p className="text-sm text-ink-2">
                  {t("admin.rhythm.rhythmForm.youCanReadEvery")}
                </p>
              </CardBody>
            </Card>
          )}
          <form
            ref={form}
            id={FORM_ID}
            onSubmit={submit}
            onReset={() => {
              setNotice(null);
              setValues({ ...stored });
            }}
            onKeyDown={onKeyDown}
            aria-busy={pending}
            className="flex flex-col gap-4"
          >
            {SECTIONS.map((section) => (
              <div key={section.id} className="flex flex-col gap-4">
                <SectionHeading
                  title={t(section.title)}
                  tag={t("admin.practice.section.saved.tag")}
                />
                {cardsOf(section).map((card) =>
                  card === "check-in"
                    ? checkInCard
                    : card === "terminology"
                      ? terminologyCard
                      : groupCard(card),
                )}
              </div>
            ))}
          </form>
          {canManage ? (
            <SettingsSaveBar
              mode="sticky"
              formId={FORM_ID}
              data-testid="rhythm-save-bar"
              unsavedTestId="rhythm-unsaved"
              unsaved={unsaved}
              saved={dirty ? null : (notice ?? state.saved)}
              error={state.error}
              pending={pending}
            />
          ) : null}
        </div>
      </RefusedContext.Provider>
    </FieldsContext.Provider>
  );
}
