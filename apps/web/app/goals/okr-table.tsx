"use client";

import type { GoalLevel } from "@openokr/db";
import { Bar, Button, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addKeyResult,
  addObjective,
  type EditorResult,
  recordKeyResultValue,
  removeGoal,
  removeKeyResult,
  renameGoal,
  renameKeyResult,
} from "./editor-actions.ts";
import { HealthChip } from "./health-chip.tsx";

/**
 * The editable OKR list on S-13 (P8-G12).
 *
 * One screen holds the objectives and their key results together, and the
 * things a member does every week happen where they are reading rather than
 * three navigations away: rename a row, move a value, add a measure, add an
 * objective, remove one.
 *
 * **Three things this does not do, and each is deliberate.**
 *
 * Health is shown and never set. METHOD.md §3 derives it from the check-ins
 * and the confidence, so a hand-settable health chip would be a second opinion
 * on the same column and the escalations would follow the one nobody typed.
 *
 * Publishing is not here. The six publish gates live on S-10 and a dropdown
 * that moved a goal past them would be a way around them rather than a
 * shortcut through them.
 *
 * A value typed here is recorded as history, by the same action a check-in
 * uses. The table is a faster door onto the same room, not a second room.
 */

interface EditableKeyResult {
  readonly id: string;
  readonly title: string;
  readonly unit: string | null;
  readonly currentValue: number;
  readonly targetValue: number;
  readonly progressPct: number;
}

export interface EditableGoal {
  readonly id: string;
  readonly title: string;
  readonly health: string;
  readonly progressPct: number;
  readonly champion: string;
  /** Null where the goal has no reviewer, which the practice allows (P9-T04). */
  readonly reviewer: string | null;
  readonly keyResults: readonly EditableKeyResult[];
}

export function OkrTable({
  goals,
  cycleId,
  level,
  canEdit,
  canAdminister,
  progressMax,
  empty,
}: {
  readonly goals: readonly EditableGoal[];
  /** Null when no cycle is selected, which is the one state that cannot add. */
  readonly cycleId: string | null;
  readonly level: GoalLevel;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  readonly empty: React.ReactNode;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);

  const run = (work: () => Promise<EditorResult>) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (result.error) {
        setProblem(result.error);
        return;
      }
      router.refresh();
    });
  };

  const toggle = (id: string) =>
    setCollapsed((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );

  return (
    <div className="flex flex-col gap-2">
      {problem ? (
        <p role="alert" className="text-xs text-bad">
          {problem}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="hidden grid-cols-[1.5rem_1fr_7rem_9rem_6rem_4rem] items-center gap-2.5 border-b border-line bg-bg px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-3 md:grid">
          <span />
          <span>{t("goals.editor.columnName")}</span>
          <span>{t("goals.editor.columnValue")}</span>
          <span>{t("goals.editor.columnProgress")}</span>
          <span>{t("goals.editor.columnHealth")}</span>
          <span />
        </div>

        {goals.length === 0 ? empty : null}

        {goals.map((goal) => {
          const open = !collapsed.includes(goal.id);
          return (
            <div key={goal.id}>
              <div className="grid grid-cols-[1.5rem_1fr] group items-center gap-2.5 border-b border-line px-3.5 py-2 hover:bg-bg md:grid-cols-[1.5rem_1fr_7rem_9rem_6rem_4rem]">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={t("goals.editor.toggleKeyResults", {
                    title: goal.title,
                  })}
                  onClick={() => toggle(goal.id)}
                  className="flex size-5 items-center justify-center rounded-control text-ink-4 hover:bg-raised hover:text-ink-2"
                >
                  <Chevron open={open} />
                </button>

                <div className="flex min-w-0 flex-col">
                  <InlineText
                    value={goal.title}
                    label={t("goals.editor.objectiveTitle")}
                    disabled={!canEdit || pending}
                    bold
                    onSave={(title) =>
                      run(() => renameGoal({ id: goal.id, title }))
                    }
                  />
                  <span className="truncate px-1.5 text-[11px] text-ink-3">
                    {goal.reviewer
                      ? t("goals.editor.roles", {
                          champion: goal.champion,
                          reviewer: goal.reviewer,
                        })
                      : t("goals.editor.rolesNoReviewer", {
                          champion: goal.champion,
                        })}
                  </span>
                </div>

                <span className="hidden text-xs text-ink-4 md:block">—</span>

                <div className="hidden items-center gap-2 md:flex">
                  <Bar
                    value={goal.progressPct}
                    max={progressMax}
                    label={goal.title}
                    className="flex-1"
                  />
                  <span className="w-9 text-right text-xs font-semibold tabular-nums text-ink-3">
                    {Math.round(goal.progressPct)}%
                  </span>
                </div>

                <div className="hidden md:block">
                  <HealthChip health={goal.health} />
                </div>

                <RowActions
                  href={`/goals/${goal.id}`}
                  openLabel={t("goals.editor.openObjective")}
                  deleteLabel={t("goals.editor.deleteObjective")}
                  canDelete={canAdminister && !pending}
                  onDelete={() => run(() => removeGoal({ id: goal.id }))}
                />
              </div>

              {open ? (
                <>
                  {goal.keyResults.map((keyResult) => (
                    <div
                      key={keyResult.id}
                      className="grid grid-cols-[1.5rem_1fr] group items-center gap-2.5 border-b border-line px-3.5 py-1.5 hover:bg-bg md:grid-cols-[1.5rem_1fr_7rem_9rem_6rem_4rem]"
                    >
                      <span />
                      <div className="min-w-0 pl-3">
                        <InlineText
                          value={keyResult.title}
                          label={t("goals.editor.keyResultTitle")}
                          disabled={!canEdit || pending}
                          onSave={(title) =>
                            run(() =>
                              renameKeyResult({ id: keyResult.id, title }),
                            )
                          }
                        />
                      </div>

                      <div className="hidden items-center gap-1 text-xs tabular-nums md:flex">
                        <InlineNumber
                          value={keyResult.currentValue}
                          label={t("goals.editor.valueFor", {
                            title: keyResult.title,
                          })}
                          disabled={!canEdit || pending}
                          onSave={(value) =>
                            run(() =>
                              recordKeyResultValue({ id: keyResult.id, value }),
                            )
                          }
                        />
                        <span className="text-ink-4">
                          / {keyResult.targetValue}
                          {keyResult.unit ? ` ${keyResult.unit}` : ""}
                        </span>
                      </div>

                      <div className="hidden items-center gap-2 md:flex">
                        <Bar
                          value={keyResult.progressPct}
                          max={progressMax}
                          label={keyResult.title}
                          className="flex-1"
                        />
                        <span className="w-9 text-right text-xs font-semibold tabular-nums text-ink-3">
                          {Math.round(keyResult.progressPct)}%
                        </span>
                      </div>

                      <span className="hidden md:block" />

                      <RowActions
                        href={`/goals/${goal.id}`}
                        openLabel={t("goals.editor.openKeyResult")}
                        deleteLabel={t("goals.editor.deleteKeyResult")}
                        canDelete={canAdminister && !pending}
                        onDelete={() =>
                          run(() => removeKeyResult({ id: keyResult.id }))
                        }
                      />
                    </div>
                  ))}

                  {canEdit ? (
                    <AddRow
                      label={t("goals.editor.addKeyResult")}
                      placeholder={t("goals.editor.keyResultPlaceholder")}
                      disabled={pending}
                      indented
                      onAdd={(title) =>
                        run(() => addKeyResult({ goalId: goal.id, title }))
                      }
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}

        {canEdit && cycleId ? (
          <AddRow
            label={t("goals.editor.addObjective")}
            placeholder={t("goals.editor.objectivePlaceholder")}
            disabled={pending}
            onAdd={(title) =>
              run(async () => {
                const created = await addObjective({
                  cycleId,
                  level,
                  title,
                });
                return { error: created.error };
              })
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
      className={open ? "size-3" : "size-3 -rotate-90"}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * A field that reads as text until somebody types in it.
 *
 * A real input rather than `contenteditable`: it is reachable with the
 * keyboard, it carries its own accessible name, and the accessibility scan
 * reads it as the control it is. Saving happens on blur and on Enter, and
 * Escape puts the stored value back, which is what the people who tested this
 * on a spreadsheet expected.
 */
function InlineText({
  value,
  label,
  disabled,
  bold,
  onSave,
}: {
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly bold?: boolean;
  readonly onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const next = draft.trim();
    if (next === "" || next === value) {
      setDraft(value);
      return;
    }
    onSave(next);
  };

  return (
    <input
      value={draft}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={`w-full truncate rounded-control border border-transparent bg-transparent px-1.5 py-0.5 text-ink outline-none hover:border-line focus:border-brand focus:bg-surface disabled:cursor-default disabled:hover:border-transparent ${
        bold ? "text-sm font-bold" : "text-xs"
      }`}
    />
  );
}

/** The value cell. Same behaviour as the title, with a number in it. */
function InlineNumber({
  value,
  label,
  disabled,
  onSave,
}: {
  readonly value: number;
  readonly label: string;
  readonly disabled: boolean;
  readonly onSave: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  const commit = () => {
    const next = Number(draft);
    if (draft.trim() === "" || Number.isNaN(next) || next === value) {
      setDraft(String(value));
      return;
    }
    onSave(next);
  };

  return (
    <input
      type="number"
      value={draft}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
      className="w-14 rounded-control border border-transparent bg-transparent px-1 py-0.5 text-right text-xs font-semibold text-ink outline-none hover:border-line focus:border-brand focus:bg-surface disabled:cursor-default disabled:hover:border-transparent"
    />
  );
}

/**
 * Open and delete, shown on hover and always reachable with the keyboard.
 *
 * `opacity-0` with `focus-within:opacity-100`, never `hidden`: a control that
 * only a mouse can reveal is a control a keyboard cannot use, which is the
 * half of the accessibility gate a scan cannot answer.
 */
function RowActions({
  href,
  openLabel,
  deleteLabel,
  canDelete,
  onDelete,
}: {
  readonly href: string;
  readonly openLabel: string;
  readonly deleteLabel: string;
  readonly canDelete: boolean;
  readonly onDelete: () => void;
}) {
  const { t } = useTranslations();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button type="button" size="sm" onClick={onDelete}>
          {t("goals.editor.confirmDelete")}
        </Button>
        <Button type="button" size="sm" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 hover:opacity-100">
      <a
        href={href}
        className="flex size-6 items-center justify-center rounded-control text-ink-4 hover:bg-raised hover:text-ink-2"
      >
        {/* The name inside the link rather than on it: an `aria-label` on an
         * anchor whose only content is a decorative icon leaves the link
         * empty for anything that reads content rather than labels. */}
        <span className="sr-only">{openLabel}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="size-3.5"
        >
          <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
        </svg>
      </a>
      {canDelete ? (
        <button
          type="button"
          aria-label={deleteLabel}
          onClick={() => setConfirming(true)}
          className="flex size-6 items-center justify-center rounded-control text-ink-4 hover:bg-bad-bg hover:text-bad"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="size-3.5"
          >
            <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The add row under a set.
 *
 * It is a link-looking button until it is pressed, then a field with a save.
 * Nothing is written by pressing the plus, which is the difference between
 * this and the spreadsheet it is modelled on: an empty objective created by a
 * mis-click is a row somebody else has to clean up.
 */
function AddRow({
  label,
  placeholder,
  disabled,
  indented,
  onAdd,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly indented?: boolean;
  readonly onAdd: (title: string) => void;
}) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const padding = indented ? "pl-11" : "pl-3.5";

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-2 border-b border-line py-2 pr-3.5 text-left text-xs font-semibold text-brand-text hover:bg-brand-weak disabled:text-ink-4 ${padding}`}
      >
        <span
          aria-hidden="true"
          className="flex size-4 items-center justify-center rounded-control border border-dashed border-brand-line bg-brand-weak"
        >
          +
        </span>
        {label}
      </button>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 border-b border-line py-2 pr-3.5 ${padding}`}
    >
      <input
        // Focused through a ref rather than `autoFocus`: the field exists
        // because somebody just pressed the control that creates it, so the
        // caret belongs here, and the attribute that does it declaratively
        // also steals focus when a page loads with one of these already open.
        ref={(node) => node?.focus()}
        value={title}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && title.trim() !== "") {
            onAdd(title.trim());
            setTitle("");
            setOpen(false);
          }
          if (event.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
      />
      <Button
        type="button"
        size="sm"
        disabled={disabled || title.trim() === ""}
        onClick={() => {
          onAdd(title.trim());
          setTitle("");
          setOpen(false);
        }}
      >
        {t("common.save")}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setTitle("");
          setOpen(false);
        }}
      >
        {t("common.cancel")}
      </Button>
    </div>
  );
}
