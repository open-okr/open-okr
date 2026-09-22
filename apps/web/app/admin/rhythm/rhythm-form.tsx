"use client";

import type { callAction } from "@openokr/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useFormDirty,
  useKeyboardRegistry,
  useSubmitShortcut,
  useTranslations,
  useUnsavedGuard,
} from "@openokr/ui";
import type { ReactNode } from "react";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { resetGroup, saveRhythm } from "./rhythm-actions.ts";
import { NOTHING_SAVED, type RhythmState } from "./rhythm-state.ts";

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
 * bound; that sentence now lands above the button.
 *
 * **A card returns to the canon.** Reset sends nulls rather than the canon's
 * current numbers, which is the difference between having no opinion and
 * having chosen today's default and keeping it after the canon moves.
 *
 * Still read-only: the six §11 word lists. They are arrays of words rather
 * than numbers, editing them is a different control, and P6-G20's deliverables
 * name clocks, ladders, bands, corridors, caps, boundaries and timings. Their
 * resolved value is shown so an admin can see what the Coach is matching on.
 */

type Rhythm = Awaited<ReturnType<typeof callAction<"rhythm.read">>>;
type RegistryEntry = Rhythm["registry"][number];

const GROUP_TITLES: Record<string, string> = {
  cadence: "Cadence and escalation",
  scoring: "Confidence and scoring",
  quality: "Quality and planning",
  alignment: "Alignment",
  kpi: "KPIs and recovery",
  sessions: "Sessions",
};

const WEEKDAYS = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
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
 * The six §11 quality word lists, read-only, as lists of words (P8-G08).
 *
 * **They were `JSON.stringify` of the whole map in one paragraph.** 148 terms
 * across six lists, rendered as a single unbroken string of quotes, brackets
 * and commas that ran past the right edge of the card. It was also styled
 * `tabular`, which is the numeral variant and belongs to the figures on this
 * screen rather than to prose.
 *
 * Still read-only, which is P6-G20's deliberate choice and not an omission:
 * editing a word list is a different control from a number field, and the
 * resolved value is shown so an admin can see what the Coach is matching on.
 * What changes is that it can now be read.
 */
function WordLists({ lists }: { readonly lists: WordListMap }) {
  return (
    <dl className="flex flex-col gap-1.5">
      {Object.entries(lists).map(([name, terms]) => (
        <div key={name} className="flex flex-col gap-0.5">
          <dt className="text-xs font-semibold text-ink-2">
            {/* The registry's own camelCase key, spaced out. Renaming these
                would mean renaming them in `packages/method`, and they are
                the canon's names rather than this screen's. */}
            {name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}
            <span className="ml-1.5 font-normal text-ink-4">
              {terms.length}
            </span>
          </dt>
          {/* `wrap-break-word` because a single list is long and a term can be
              two words: without it the row sets the card's width and the
              whole page scrolls sideways. */}
          <dd className="wrap-break-word text-xs text-ink-3">
            {terms.join(", ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One registry row: scalar, composite, or shown as it stands. */
function Parameter({
  entry,
  resolved,
  override,
  canManage,
}: {
  readonly entry: RegistryEntry;
  readonly resolved: unknown;
  readonly override: unknown;
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();

  const parts = numericParts(resolved);
  const words = wordLists(resolved);
  // A list's fields carry a different prefix, so the save can put an array
  // back together as an array.
  const prefix = Array.isArray(resolved) ? "list" : "composite";
  const overrideParts =
    override && typeof override === "object"
      ? (override as Record<string, unknown>)
      : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-ink">{entry.label}</span>
        <span className="flex items-center gap-2">
          <Chip tone="neutral">
            {t("admin.rhythm.rhythmForm.method", { section: entry.section })}
          </Chip>
          {override === undefined ? null : (
            <Chip tone="brand">{t("common.changed")}</Chip>
          )}
        </span>
      </div>
      <p className="text-sm text-ink-3">{entry.why}</p>

      {typeof resolved === "number" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="number"
            step="any"
            name={`threshold:${entry.key}`}
            disabled={!canManage}
            defaultValue={override === undefined ? "" : String(override)}
            placeholder={String(resolved)}
            className="w-28 rounded-md border border-line bg-bg px-2 py-1 tabular"
          />
          <span className="text-ink-3">
            {t("admin.rhythm.rhythmForm.inForceLeaveBlankFor", {
              resolved: String(resolved),
            })}
          </span>
        </label>
      ) : parts ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2.5">
            {parts.map(([part, inForce]) => (
              <label
                key={part}
                className="flex flex-col gap-0.5 text-xs text-ink-3"
              >
                {part}
                <input
                  type="number"
                  step="any"
                  name={`${prefix}:${entry.key}:${part}`}
                  disabled={!canManage}
                  defaultValue={
                    overrideParts && typeof overrideParts[part] === "number"
                      ? String(overrideParts[part])
                      : ""
                  }
                  placeholder={String(inForce)}
                  className="w-24 rounded-md border border-line bg-bg px-2 py-1 text-sm tabular"
                />
              </label>
            ))}
          </div>
          <span className="text-xs text-ink-4">
            {t("admin.rhythm.rhythmForm.fillInEveryPart")}
          </span>
        </div>
      ) : words ? (
        <WordLists lists={words} />
      ) : (
        <p className="text-sm text-ink-3">
          {t("admin.rhythm.rhythmForm.inForce", {
            resolved: JSON.stringify(resolved),
          })}
          <span className="ml-1.5 text-ink-4">
            {t("admin.rhythm.rhythmForm.shownAsItStands")}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * "Return this card to the canon", for one group.
 *
 * Reports its outcome upward rather than printing it, so the card shows one
 * status line whether it came from a save or a reset. Two of them side by side
 * in the header would be two places to look for the same kind of sentence.
 */
function ResetCard({
  keys,
  disabled,
  onOutcome,
}: {
  readonly keys: readonly string[];
  readonly disabled: boolean;
  readonly onOutcome: (outcome: RhythmState, cleared: boolean) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => {
        if (
          !window.confirm(
            "Return every threshold in this card to the canon? Anything this workspace changed here goes back to METHOD.md's number. Nothing else moves.",
          )
        ) {
          return;
        }
        start(async () => {
          const outcome = await resetGroup(keys);
          onOutcome(outcome, outcome.error === null);
        });
      }}
      className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 disabled:opacity-60"
    >
      {pending ? "Resetting…" : "Reset to the canon"}
    </button>
  );
}

/**
 * One card, which is one form, which saves itself (P8-G11).
 *
 * **This screen had a single Save at the bottom of 8,001 pixels**, governing
 * 123 fields across eight cards. Measured on 22 September 2026: the button sat
 * 7,785px below the first field it controlled, which is 9.6 viewports on a
 * 814px-tall page. Change the check-in grace at the top and the way to commit
 * it was ten screens away, with nothing in between to say the edit was still
 * uncommitted.
 *
 * Nothing about the saving needed to change to fix it. `rhythm.update` already
 * takes every field as optional and merges `overrides` rather than replacing
 * them, which `resetGroup` has relied on since P6-G20. So a card can send its
 * own thresholds and no others, and eight small saves do what one large one
 * did.
 *
 * **The pattern is the product's own, not a new one.** `/admin/ai` is 6.7
 * viewports tall with 35 forms and its worst field-to-button distance is
 * 126px; `/admin/nudges` is 6.1 viewports and saves per rule card. Those two
 * are why a long settings page is not by itself the problem.
 */
function SettingsCard({
  id,
  title,
  description,
  canManage,
  resetKeys,
  children,
}: {
  /** Distinguishes this card's unsaved state from its siblings'. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly canManage: boolean;
  /** The §11 keys "Reset to the canon" returns, for a group card. */
  readonly resetKeys?: readonly string[];
  readonly children: ReactNode;
}) {
  const { t } = useTranslations();
  const form = useRef<HTMLFormElement>(null);
  const [state, submit, pending] = useActionState(saveRhythm, NOTHING_SAVED);
  const [resetOutcome, setResetOutcome] = useState<RhythmState>(NOTHING_SAVED);
  // Which of the two produced the sentence on screen. Whichever happened last
  // wins: without this, a save that was refused would leave its refusal above
  // a reset that then succeeded, and the card would be showing an error about
  // something it no longer holds.
  const [showingReset, setShowingReset] = useState(false);
  const { dirty, markSaved } = useFormDirty(form);
  const onKeyDown = useSubmitShortcut(canManage);

  useUnsavedGuard(`rhythm:${id}`, dirty);

  // Watched on the edge of `pending` rather than on the message, because two
  // saves in a row produce the same sentence and an effect keyed on the text
  // would not run the second time. The form would then keep reporting unsaved
  // work it had already committed.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      // Either way round, the save is the newer of the two.
      setShowingReset(false);
      if (state.error === null && state.saved) {
        markSaved();
      }
    }
    wasPending.current = pending;
  }, [pending, state, markSaved]);

  const afterReset = useCallback(
    (outcome: RhythmState, cleared: boolean) => {
      setResetOutcome(outcome);
      setShowingReset(true);
      if (!cleared) {
        return;
      }
      // Blanked rather than re-read from the server. Blank is exactly what
      // reset wrote: the field means "this workspace has no opinion" and the
      // placeholder beside it is the canon's own number. Calling `reset()` on
      // the element instead would restore whatever `defaultValue` React last
      // rendered, which is the pre-reset value until the revalidation lands.
      const element = form.current;
      if (!element) {
        return;
      }
      for (const field of element.querySelectorAll<HTMLInputElement>(
        'input[name^="threshold:"], input[name^="composite:"], input[name^="list:"]',
      )) {
        field.value = "";
      }
      markSaved();
    },
    [markSaved],
  );

  const outcome = showingReset ? resetOutcome : state;
  const { error: message, saved: confirmation } = outcome;

  return (
    <form
      ref={form}
      action={submit}
      aria-busy={pending}
      onKeyDown={onKeyDown}
      data-testid={`rhythm-card-${id}`}
    >
      <Card>
        {/*
         * Stuck to the top of the scrollport while this card is the one on
         * screen. Per-card forms took the worst field-to-button distance from
         * 7,785px to 1,701px, and four of the eight cards were still over one
         * viewport, which is the same complaint at a quarter of the size.
         * Sticky closes the rest: whichever card you are inside, its own Save
         * is in view, and the next card's header takes over as you reach it.
         * `bg-surface` because a sticky header with no background of its own
         * would have the card's fields scroll through it.
         */}
        <CardHeader className="sticky top-0 z-10 flex-wrap justify-between rounded-t-lg bg-surface">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-semibold text-ink">{title}</h2>
            {description ? (
              <p className="text-sm text-ink-3">{description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {dirty && canManage ? (
              <Chip tone="brand">{t("common.unsaved")}</Chip>
            ) : null}
            {resetKeys ? (
              <ResetCard
                keys={resetKeys}
                disabled={!canManage}
                onOutcome={afterReset}
              />
            ) : null}
            {canManage ? (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={pending}
              >
                {pending ? "Saving…" : t("common.save")}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        {message || confirmation ? (
          <div className="border-b border-line px-3.5 py-2">
            {message ? (
              <p
                role="alert"
                data-testid="rhythm-save"
                className="max-w-prose text-sm text-bad"
              >
                {message}
              </p>
            ) : (
              <p
                role="status"
                data-testid="rhythm-save"
                className="text-sm text-ok"
              >
                {confirmation}
              </p>
            )}
          </div>
        ) : null}

        <CardBody className="flex flex-col gap-3.5">{children}</CardBody>
      </Card>
    </form>
  );
}

export function RhythmForm({
  rhythm,
  canManage,
}: {
  readonly rhythm: Rhythm;
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
  const groups = [...new Set(rhythm.registry.map((entry) => entry.group))];
  const { register, unregister } = useKeyboardRegistry();

  // Registered once for the page rather than once per card. The registry
  // dedupes by id, but a card unmounting would then take the entry away from
  // the seven still on screen.
  useEffect(() => {
    register({
      id: "form.save",
      keys: "⌘⏎",
      description: "Save the card the caret is in",
      group: "Detail",
    });
    return () => unregister("form.save");
  }, [register, unregister]);

  return (
    <div className="flex flex-col gap-4.5">
      {canManage ? null : (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("admin.rhythm.rhythmForm.youCanReadEvery")}
            </p>
          </CardBody>
        </Card>
      )}

      <SettingsCard
        id="check-in"
        title={t("admin.rhythm.rhythmForm.theCheckInRhythm")}
        description={t("admin.rhythm.rhythmForm.theseThreeHaveTheir")}
        canManage={canManage}
      >
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span className="text-ink-2">
              {t("admin.rhythm.rhythmForm.checkInFrequency")}
            </span>
            <select
              name="defaultCheckInFrequency"
              disabled={!canManage}
              defaultValue={rhythm.defaultCheckInFrequency}
              className="rounded-md border border-line bg-bg px-2 py-1"
            >
              {["daily", "weekly", "biweekly", "monthly", "quarterly"].map(
                (option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-ink-2">
              {t("admin.rhythm.rhythmForm.anchorDay")}
            </span>
            <select
              name="checkInAnchorDay"
              disabled={!canManage}
              defaultValue={String(rhythm.checkInAnchorDay)}
              className="rounded-md border border-line bg-bg px-2 py-1"
            >
              {WEEKDAYS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-ink-2">
              {t("admin.rhythm.rhythmForm.coachStrictness")}
            </span>
            <select
              name="coachStrictness"
              disabled={!canManage}
              defaultValue={rhythm.coachStrictness}
              className="rounded-md border border-line bg-bg px-2 py-1"
            >
              {["advisory", "warn", "strict"].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-ink-3">
            {t("admin.rhythm.rhythmForm.theSixPublishGates")}
          </p>
        </div>
      </SettingsCard>

      {groups.map((group) => {
        const rows = rhythm.registry.filter(
          (entry) => entry.group === group && !entry.columnBacked,
        );
        return (
          <SettingsCard
            key={group}
            id={group}
            title={GROUP_TITLES[group] ?? group}
            canManage={canManage}
            resetKeys={rows.map((entry) => entry.key)}
          >
            {rows.map((entry) => (
              <Parameter
                key={entry.key}
                entry={entry}
                resolved={rhythm.thresholds[entry.key]}
                override={rhythm.overrides[entry.key]}
                canManage={canManage}
              />
            ))}
          </SettingsCard>
        );
      })}

      <SettingsCard
        id="terminology"
        title={t("admin.rhythm.rhythmForm.terminology")}
        description={t("admin.rhythm.rhythmForm.renameAConceptThe")}
        canManage={canManage}
      >
        <div className="flex flex-col gap-2 text-sm">
          {Object.entries(rhythm.terminology).map(([term, label]) => {
            const value = label as { singular: string; plural: string };
            return (
              <div key={term} className="flex items-center gap-2">
                <span className="w-32 text-ink-3">{term}</span>
                <input
                  name={`label:${term}:singular`}
                  disabled={!canManage}
                  defaultValue={value.singular}
                  className="w-40 rounded-md border border-line bg-bg px-2 py-1"
                />
                <input
                  name={`label:${term}:plural`}
                  disabled={!canManage}
                  defaultValue={value.plural}
                  className="w-40 rounded-md border border-line bg-bg px-2 py-1"
                />
              </div>
            );
          })}
        </div>
      </SettingsCard>
    </div>
  );
}
