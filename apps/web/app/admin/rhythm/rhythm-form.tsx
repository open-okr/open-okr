"use client";

import type { callAction } from "@openokr/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useActionState, useState, useTransition } from "react";
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
            {t("admin.rhythm.rhythmForm.method")} {entry.section}
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
            {t("admin.rhythm.rhythmForm.inForce")} {String(resolved)}
            {t("admin.rhythm.rhythmForm.leaveBlankForThe")}
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
      ) : (
        <p className="tabular text-sm text-ink-3">
          {t("admin.rhythm.rhythmForm.inForce")} {JSON.stringify(resolved)}
          <span className="ml-1.5 text-ink-4">
            {t("admin.rhythm.rhythmForm.shownAsItStands")}
          </span>
        </p>
      )}
    </div>
  );
}

/** "Return this card to the canon", for one group. */
function ResetCard({
  keys,
  disabled,
}: {
  readonly keys: readonly string[];
  readonly disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<RhythmState>(NOTHING_SAVED);

  return (
    <div className="flex flex-col items-end gap-1">
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
            setOutcome(await resetGroup(keys));
          });
        }}
        className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 disabled:opacity-60"
      >
        {pending ? "Resetting…" : "Reset to the canon"}
      </button>
      {outcome.error ? (
        <p role="alert" className="text-xs text-bad">
          {outcome.error}
        </p>
      ) : outcome.saved ? (
        <p role="status" className="text-xs text-ok">
          {outcome.saved}
        </p>
      ) : null}
    </div>
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

  const [state, submit, pending] = useActionState(saveRhythm, NOTHING_SAVED);
  const groups = [...new Set(rhythm.registry.map((entry) => entry.group))];

  return (
    <form action={submit} aria-busy={pending} className="flex flex-col gap-4.5">
      {canManage ? null : (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("admin.rhythm.rhythmForm.youCanReadEvery")}
            </p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-ink">
            {t("admin.rhythm.rhythmForm.theCheckInRhythm")}
          </h2>
          <p className="text-sm text-ink-3">
            {t("admin.rhythm.rhythmForm.theseThreeHaveTheir")}
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 text-sm">
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
        </CardBody>
      </Card>

      {groups.map((group) => {
        const rows = rhythm.registry.filter(
          (entry) => entry.group === group && !entry.columnBacked,
        );
        return (
          <Card key={group}>
            <CardHeader className="justify-between">
              <h2 className="font-semibold text-ink">
                {GROUP_TITLES[group] ?? group}
              </h2>
              <ResetCard
                keys={rows.map((entry) => entry.key)}
                disabled={!canManage}
              />
            </CardHeader>
            <CardBody className="flex flex-col gap-3.5">
              {rows.map((entry) => (
                <Parameter
                  key={entry.key}
                  entry={entry}
                  resolved={rhythm.thresholds[entry.key]}
                  override={rhythm.overrides[entry.key]}
                  canManage={canManage}
                />
              ))}
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-ink">
            {t("admin.rhythm.rhythmForm.terminology")}
          </h2>
          <p className="text-sm text-ink-3">
            {t("admin.rhythm.rhythmForm.renameAConceptThe")}
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-2 text-sm">
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
        </CardBody>
      </Card>

      <div className="flex flex-col gap-1.5">
        <Button type="submit" disabled={!canManage || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.error ? (
          <p
            role="alert"
            data-testid="rhythm-save"
            className="max-w-prose text-sm text-bad"
          >
            {state.error}
          </p>
        ) : state.saved ? (
          <p
            role="status"
            data-testid="rhythm-save"
            className="text-sm text-ok"
          >
            {state.saved}
          </p>
        ) : null}
      </div>
    </form>
  );
}
