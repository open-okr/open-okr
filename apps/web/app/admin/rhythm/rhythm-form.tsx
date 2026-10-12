"use client";

import type { callAction } from "@openokr/core";
import { isTermKey, suggestedTerm } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  NumberInput,
  SelectInput,
  TextInput,
  TokenInput,
  useFormDirty,
  useKeyboardRegistry,
  useSubmitShortcut,
  useToast,
  useTranslations,
  useUnsavedGuard,
} from "@openokr/ui";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import {
  createContext,
  Fragment,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

/** Catalogue keys for each group's card title. */
const GROUP_TITLES: Record<string, string> = {
  cadence: "admin.rhythm.rhythmForm.groupCadence",
  scoring: "admin.rhythm.rhythmForm.groupScoring",
  quality: "admin.rhythm.rhythmForm.groupQuality",
  alignment: "goals.alignment",
  kpi: "admin.rhythm.rhythmForm.groupKpi",
  sessions: "common.sessions",
};

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
 * The six §11 quality word lists, read-only, as lists of words (P8-G08).
 *
 * **They were `JSON.stringify` of the whole map in one paragraph.** 148 terms
 * across six lists, rendered as a single unbroken string of quotes, brackets
 * and commas that ran past the right edge of the card. It was also styled
 * `tabular`, which is the numeral variant and belongs to the figures on this
 * screen rather than to prose.
 *
 * **A workspace may now add to them, and may not take from them (P8-G11b).**
 * That asymmetry is METHOD.md's, not this screen's: §11 words the parameter as
 * "a workspace may add terms; the canon terms remain", and
 * `resolveThresholds` merges rather than replaces for the reason its own
 * comment gives, which is that replacing would let a workspace switch a
 * quality rule off by storing an empty list. So the built-in terms are shown
 * and cannot be edited, and the box beside them holds this workspace's own.
 * Agung asked on 23 September 2026 whether the values could be changed; this
 * is the half of that question the method allows answering yes to.
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
  /** What this workspace stored, which is what the box holds. */
  readonly added: Record<string, unknown> | null;
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  return (
    <dl className="flex flex-col gap-2.5">
      {Object.entries(lists).map(([name, terms]) => {
        const ours = Array.isArray(added?.[name])
          ? (added[name] as readonly string[])
          : [];
        const theirs = terms.filter((term) => !ours.includes(term));
        const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
        return (
          <div key={name} className="flex flex-col gap-0.5">
            <dt className="text-xs font-semibold text-ink-2">
              {/* The registry's own camelCase key, spaced out. Renaming these
                  would mean renaming them in `packages/method`, and they are
                  the method's names rather than this screen's. */}
              {spaced}
              <span className="ml-1.5 font-normal text-ink-4">
                {theirs.length}
                {ours.length > 0 ? ` + ${ours.length}` : ""}
              </span>
            </dt>
            {/* `wrap-break-word` because a single list is long and a term can
                be two words: without it the row sets the card's width and the
                whole page scrolls sideways. */}
            <dd className="wrap-break-word text-xs text-ink-3">
              {theirs.join(", ")}
            </dd>
            <dd>
              {/* A chip each, split on commas only, because a term can be two
                  words (guided-inputs §4.11). Named with its list, where six
                  boxes all answered to "Your own terms". */}
              <TokenInput
                label={t("admin.rhythm.rhythmForm.yourOwnTermsIn", {
                  list: spaced,
                })}
                name={`words:${entryKey}:${name}`}
                separators="commas"
                normalise={(term) => term.toLowerCase()}
                disabled={!canManage}
                defaultValue={ours}
                placeholder={t("admin.rhythm.rhythmForm.noneAdded")}
              />
            </dd>
          </div>
        );
      })}
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

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-ink">{entry.label}</span>
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
      <p className="text-sm text-ink-3">{entry.why}</p>

      {typeof resolved === "number" ? (
        <div className="flex items-center gap-2 text-sm">
          {/* No min or max: the field would pull an out-of-range number back
              to the nearest bound without a word, where the server refuses
              it in words under the box (guided-inputs §6, 10c). */}
          <NumberInput
            label={entry.label}
            hideLabel
            name={`threshold:${entry.key}`}
            step={Number.isInteger(resolved) ? 1 : 0.01}
            disabled={!canManage}
            defaultValue={typeof override === "number" ? override : null}
            placeholder={String(resolved)}
            invalid={refusal !== null}
            aria-describedby={refusal === null ? undefined : errorId}
            inputClassName="w-28"
          />
          <span className="text-ink-3">
            {t("admin.rhythm.rhythmForm.inForceLeaveBlankFor", {
              resolved: String(resolved),
            })}
          </span>
        </div>
      ) : parts ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2.5">
            {parts.map(([part, inForce]) => (
              <NumberInput
                key={part}
                label={part}
                name={`${prefix}:${entry.key}:${part}`}
                step={Number.isInteger(inForce) ? 1 : 0.01}
                disabled={!canManage}
                defaultValue={
                  overrideParts && typeof overrideParts[part] === "number"
                    ? overrideParts[part]
                    : null
                }
                placeholder={String(inForce)}
                invalid={refusal !== null}
                aria-describedby={refusal === null ? undefined : errorId}
                inputClassName="w-24"
              />
            ))}
          </div>
          <span className="text-xs text-ink-4">
            {t("admin.rhythm.rhythmForm.fillInEveryPart")}
          </span>
        </div>
      ) : words ? (
        <WordLists
          lists={words}
          entryKey={entry.key}
          added={overrideParts as Record<string, unknown> | null}
          canManage={canManage}
        />
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

      {/*
       * The method's own sentence, under the box it is about. Deliberately not
       * a live region: the toast carries the announcement, and two of them
       * would read one refusal out twice.
       */}
      {refusal === null ? null : (
        <p
          id={errorId}
          data-testid="rhythm-field-error"
          className="text-sm text-bad"
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
 * Null when the sentence is about the card rather than a parameter, which is
 * the "nothing on this card to save" case. The toast still shows; there is
 * simply no field to go to.
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
 * A scalar is `threshold:<key>`; a composite's parts are
 * `composite:<key>:<part>` and a list's are `list:<key>:<part>`, so the first
 * match of any of the three is the field to go to. `block: "center"` rather
 * than the default, because the card header is sticky and would otherwise sit
 * over a field aligned to the top.
 */
function focusRefused(
  element: HTMLFormElement | null,
  refusal: Refusal | null,
): void {
  if (element === null || refusal === null) {
    return;
  }
  const escaped = CSS.escape(refusal.key);
  const field = element.querySelector<HTMLInputElement>(
    `input[name="threshold:${escaped}"], input[name^="composite:${escaped}:"], input[name^="list:${escaped}:"]`,
  );
  if (field === null) {
    return;
  }
  field.scrollIntoView({ block: "center", behavior: "smooth" });
  field.focus({ preventScroll: true });
}

/**
 * "Return this card to its defaults", for one group.
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
  const { t } = useTranslations();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => {
        if (!window.confirm(t("admin.rhythm.rhythmForm.resetCardConfirm"))) {
          return;
        }
        start(async () => {
          const outcome = await resetGroup(keys);
          onOutcome(outcome, outcome.error === null);
        });
      }}
      className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 disabled:opacity-60"
    >
      {pending
        ? t("admin.rhythm.rhythmForm.resetting")
        : t("common.resetToDefaults")}
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
  /** The §11 keys "Reset to defaults" returns, for a group card. */
  readonly resetKeys?: readonly string[];
  readonly children: ReactNode;
}) {
  const { t } = useTranslations();
  const toast = useToast();
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

  // **Sent through a transition, not the form's own action**, because React
  // resets a form with an `action` as soon as that action resolves. For a
  // refusal that was wrong twice over: the value somebody typed was gone
  // before they had read why (500 typed, refused as "<=200", and the box
  // already back to 200 within 500ms, measured on 23 September 2026), and the
  // message then described a number no longer on screen. The card used to put
  // the typed values back by name afterwards, which a kit field holding its
  // own value (a number field, a word list) never hears (guided-inputs 10c).
  // Not reset, everything stays where it was typed, refused or saved.
  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(
        event.currentTarget,
        (event.nativeEvent as SubmitEvent).submitter,
      );
      startTransition(() => submit(data));
    },
    [submit],
  );
  // Bumped when a reset clears the card, so its fields are drawn again on
  // what the server now holds.
  const [generation, setGeneration] = useState(0);

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
      // Drawn again rather than blanked by hand. The reset's own response
      // carries the page as the server now holds it, and every field, a kit
      // field holding its own value included, starts again from that: blank,
      // with the canon's number as its placeholder.
      setGeneration((one) => one + 1);
      markSaved();
    },
    [markSaved],
  );

  const outcome = showingReset ? resetOutcome : state;
  const { error: message, saved: confirmation } = outcome;

  // Which parameter the refusal is about, for the message under its own field.
  // Memoised on the sentence rather than recomputed, so the context value is
  // the same object between renders and the card's parameters are not all
  // re-rendered on every keystroke.
  const refused = useMemo<Refusal | null>(
    () => (message === null ? null : refusedParameter(message)),
    [message],
  );

  // **The refusal used to render here and be invisible.** It sat above the
  // card body, and a card runs to 1,700px with its Save in a header that stays
  // on screen, so pressing Save at the bottom of twenty parameters put the
  // sentence off the top of the window with nothing to suggest it existed.
  // Three things now carry it: a toast that comes to the reader, a message
  // under the field the method named, and the field itself brought into view.
  const shown = useRef<RhythmState>(NOTHING_SAVED);
  useEffect(() => {
    if (shown.current === outcome) {
      return;
    }
    shown.current = outcome;
    if (message !== null) {
      toast.show({ tone: "bad", title, message, source: id });
      focusRefused(form.current, refused);
      return;
    }
    if (confirmation !== null) {
      toast.show({ tone: "ok", title, message: confirmation, source: id });
    }
  }, [outcome, message, confirmation, title, toast, refused, id]);

  return (
    <form
      ref={form}
      action={submit}
      aria-busy={pending}
      onSubmit={onSubmit}
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
                {pending
                  ? t("admin.rhythm.rhythmForm.saving")
                  : t("common.save")}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardBody className="flex flex-col gap-3.5">
          {/*
           * The offending parameter reads its own message from here rather
           * than being handed one, because the cards' children are built in
           * `RhythmForm` and threading a prop through would mean every card
           * knowing about refusals it cannot produce.
           */}
          <RefusedContext.Provider value={refused}>
            <Fragment key={generation}>{children}</Fragment>
          </RefusedContext.Provider>
        </CardBody>
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
      description: t("admin.rhythm.rhythmForm.saveTheCardShortcut"),
      group: "Detail",
    });
    return () => unregister("form.save");
  }, [register, unregister, t]);

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
        description={t("admin.rhythm.rhythmForm.theseTwoHaveTheir")}
        canManage={canManage}
      >
        <div className="flex flex-col gap-3 text-sm">
          <SelectInput
            label={t("admin.rhythm.rhythmForm.checkInFrequency")}
            name="defaultCheckInFrequency"
            disabled={!canManage}
            defaultValue={rhythm.defaultCheckInFrequency}
            className="flex-row items-center justify-between gap-3"
            inputClassName="w-auto"
          >
            {["daily", "weekly", "biweekly", "monthly", "quarterly"].map(
              (option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ),
            )}
          </SelectInput>
          <SelectInput
            label={t("admin.rhythm.rhythmForm.anchorDay")}
            name="checkInAnchorDay"
            disabled={!canManage}
            defaultValue={String(rhythm.checkInAnchorDay)}
            className="flex-row items-center justify-between gap-3"
            inputClassName="w-auto"
          >
            {WEEKDAYS.map(([value, labelKey]) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </SelectInput>
          {/*
           * **Coach strictness left this card at P9-T05.** Every check now has
           * its own level (METHOD.md §4), and strict mode, which raises them
           * all to block, is one setting among the practice's. Two switches
           * for one behaviour is two places for an admin to look, and data
           * change 0015 carried every workspace that had chosen strict across.
           */}
          <p className="text-sm text-ink-3">
            {t("admin.rhythm.rhythmForm.strictModeIsOnThe")}{" "}
            <Link href="/admin/practice" className="text-brand-text underline">
              {t("admin.practice.title")}
            </Link>
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
            title={GROUP_TITLES[group] ? t(GROUP_TITLES[group]) : group}
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
            const suggested = isTermKey(term) ? suggestedTerm(term) : undefined;
            return (
              <div key={term} className="flex flex-wrap items-center gap-2">
                <span className="w-32 text-ink-3">{term}</span>
                {/* Each named, where the two boxes had no label, and held
                    to the method's 40 (termLabelSchema). */}
                <TextInput
                  label={t("admin.rhythm.rhythmForm.termSingular", { term })}
                  hideLabel
                  name={`label:${term}:singular`}
                  maxLength={40}
                  disabled={!canManage}
                  defaultValue={value.singular}
                  className="w-40"
                />
                <TextInput
                  label={t("admin.rhythm.rhythmForm.termPlural", { term })}
                  hideLabel
                  name={`label:${term}:plural`}
                  maxLength={40}
                  disabled={!canManage}
                  defaultValue={value.plural}
                  className="w-40"
                />
                {suggested &&
                canManage &&
                value.singular !== suggested.singular ? (
                  // METHOD.md's terms name a common alternative (D6, P9-T21).
                  // Offered rather than applied: it fills both fields and the
                  // card's own Save decides.
                  <Button
                    type="button"
                    size="sm"
                    onClick={(event) => {
                      const form = event.currentTarget.form;
                      for (const [form_, word] of [
                        ["singular", suggested.singular],
                        ["plural", suggested.plural],
                      ] as const) {
                        const field = form?.elements.namedItem(
                          `label:${term}:${form_}`,
                        );
                        if (field instanceof HTMLInputElement) {
                          field.value = word;
                          // The unsaved-changes tracker listens for input.
                          field.dispatchEvent(
                            new Event("input", { bubbles: true }),
                          );
                        }
                      }
                    }}
                  >
                    {t("admin.rhythm.rhythmForm.useSuggested", {
                      singular: suggested.singular,
                    })}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </SettingsCard>
    </div>
  );
}
