"use client";

import { Menu } from "@base-ui-components/react/menu";
import type { GoalLevel } from "@openokr/db";
import {
  confidenceBand,
  keyResultKindsInUse,
  okrKindsInUse,
} from "@openokr/method";
import {
  Avatar,
  Bar,
  Button,
  Chip,
  formatConfidence,
  KeyboardList,
  Spinner,
  TextInput,
  Tooltip,
  useIsMutating,
  useQueryClient,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { dayLabel } from "../../lib/day-label.ts";
import { focusOnMount } from "../../lib/focus-on-mount.ts";
import {
  filterGoals,
  type OkrFilters,
  type OkrGoal,
  type OkrScope,
  type OkrTree,
  okrCycleKey,
} from "../../lib/okr-tree/cache.ts";
import {
  type OkrHandle,
  useOkrLive,
  useOkrMutation,
  useOkrTree,
  usePendingOkrIds,
} from "../../lib/okr-tree/use-okr-tree.ts";
import { reviewerIsChampion } from "../../lib/reviewer-is-champion.ts";
import { unitsInUse } from "../../lib/units-in-use.ts";
import { addKeyResult, addObjective } from "./editor-actions.ts";
import { HealthChip } from "./health-chip.tsx";
import {
  AddedMidCycle,
  AdditionDraftMark,
  DoneToggle,
  InlineConfidence,
  InlineDate,
  InlineNumber,
  InlineText,
  InlineUnit,
  KeyResultKindPicker,
  KindControl,
  MemberPicker,
  type Person,
  ReasonField,
  SpacePicker,
  VerdictChips,
  WaitingDraft,
} from "./okr-cells.tsx";
import { OkrDrawer, useDrawerAddress } from "./okr-drawer.tsx";
import {
  type Coach,
  useKeyResultCells,
  useObjectiveCells,
} from "./okr-editing.ts";
import {
  RestrictedWriting,
  type WritingRefusal,
} from "./restricted-writing.tsx";

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
 *
 * **Every cell is edited where it is read since P9-T07a-a**: titles with the
 * checks that judge them coaching as the reader types, the champion and the
 * owner, the value, the target with its reason when it eases, the baseline,
 * the unit and the due date. The cells are in `okr-cells.tsx`, and what each
 * one sends is in `okr-editing.ts`, which the drawer shares (P9-T08a).
 */

/**
 * A key result's row on a wide screen, and the band above the rows: the
 * title and its meta line, the value, the progress, the confidence, the
 * actions. Below `md` the row is two columns (see KeyResultRow).
 */
const KEY_RESULT_GRID = "md:grid-cols-[minmax(0,1fr)_140px_160px_76px_64px]";

/**
 * A meta line: the values the row carries, read as one sentence with a dot
 * between them on a wide screen and wrapped without dots on a phone. A part
 * that renders nothing leaves an empty wrapper, which is hidden and earns no
 * dot; the phone-only health chip earns none either. Its fields read as text
 * until they are used (`data-text-first` in globals.css).
 */
const META = [
  "flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3",
  "[&>*:empty]:hidden md:gap-x-0",
  "md:[&>*:not(:empty):not([data-phone-only])~*:not(:empty)]:before:mx-[7px]",
  "md:[&>*:not(:empty):not([data-phone-only])~*:not(:empty)]:before:text-ink-4",
  "md:[&>*:not(:empty):not([data-phone-only])~*:not(:empty)]:before:content-['·']",
].join(" ");

/** The dot before a confidence, in its METHOD.md §3.2 band's colour. */
const CONFIDENCE_DOT: Record<"high" | "medium" | "low", string> = {
  high: "bg-ok-dot",
  medium: "bg-warn-dot",
  low: "bg-bad-dot",
};

interface Mover {
  readonly label: string;
  readonly move: (by: -1 | 1) => void;
  readonly onDragStart: () => void;
  /** The drag ended, dropped anywhere or nowhere: forget it. */
  readonly onDragEnd: () => void;
  /** Whether what is being dragged may land here (same set, not itself). */
  readonly accepts: () => boolean;
  /** Dragged over this row, in its lower half when `after`: show where. */
  readonly onHover: (after: boolean) => void;
  /** Dropped on this row, in its lower half when `after`. */
  readonly onDrop: (after: boolean) => void;
}

/** What the row does with Alt and an arrow, a drag over it and a drop. */
function moverHandlers(mover: Mover | null) {
  if (!mover) {
    return {};
  }
  return {
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (!event.altKey) {
        return;
      }
      // Stopped where it is handled: the objective's whole card carries a
      // mover too since the drag fix, and a key result's Alt and arrow
      // bubbling to it moved the objective as well (s13c).
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        mover.move(-1);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        mover.move(1);
      }
    },
    // Only a target that takes the dragged row answers, and then stops the
    // event: a key result row under a dragged objective lets it pass to the
    // objective's card, which is the target for objectives. Answering every
    // drag was why an objective dropped anywhere but on another objective's
    // head did nothing (Goals drag fix, 2 November 2026).
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (!mover.accepts()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const box = event.currentTarget.getBoundingClientRect();
      mover.onHover(event.clientY > box.top + box.height / 2);
    },
    onDrop: (event: React.DragEvent<HTMLElement>) => {
      if (!mover.accepts()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const box = event.currentTarget.getBoundingClientRect();
      mover.onDrop(event.clientY > box.top + box.height / 2);
    },
  };
}

/**
 * Where a dragged row will land: a brand line on the side it will take.
 * Without it a drag had to be dropped on faith, and a miss did nothing.
 * Between cards the line sits in the gap rather than on the card's border.
 */
function DropLine({
  at,
  gap = false,
}: {
  /** True below, false above, null when nothing is dragged here. */
  readonly at: boolean | null;
  readonly gap?: boolean;
}) {
  if (at === null) {
    return null;
  }
  const edge = gap
    ? at
      ? "-bottom-[7px]"
      : "-top-[7px]"
    : at
      ? "-bottom-px"
      : "-top-px";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-brand ${edge}`}
    />
  );
}

/**
 * The grip: dragged to move the row, and the place the keyboard is put back
 * after a move so Alt and an arrow can be pressed again. Hidden until the
 * row is hovered or the grip is focused, never removed, so a keyboard always
 * reaches it.
 */
function Grip({ id, mover }: { readonly id: string; readonly mover: Mover }) {
  const { t } = useTranslations();
  return (
    <Tooltip label={t("okrList.reorderHint")} side="left">
      <button
        type="button"
        data-grip={id}
        aria-label={mover.label}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", id);
          mover.onDragStart();
        }}
        onDragEnd={mover.onDragEnd}
        className="flex size-5 cursor-grab items-center justify-center rounded-control text-ink-4 opacity-0 hover:bg-raised hover:text-ink-2 focus:opacity-100 group-hover:opacity-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="size-3.5"
        >
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
    </Tooltip>
  );
}

/** Where "Collapse all" is remembered, per browser (owner decision Q3). */
const FOLD_KEY = "openokr.goals.fold";

export function OkrTable({
  initialTree,
  initialAt,
  scope,
  filters,
  cycleId,
  level,
  canEdit,
  canAdminister,
  progressMax,
  members,
  spaces,
  coach,
  refusal,
  empty,
}: {
  /** The server's render of the cycle's tree, or null with no cycle. */
  readonly initialTree: OkrTree | null;
  /** When the server read it, so the cache knows how fresh it is. */
  readonly initialAt: number;
  readonly scope: OkrScope;
  /** Applied to the cache the way the server applied them to its render. */
  readonly filters: OkrFilters;
  /** Null when no cycle is selected, which is the one state that cannot add. */
  readonly cycleId: string | null;
  readonly level: GoalLevel;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  /** People who may champion an objective or own a key result. */
  readonly members: readonly Person[];
  /** The spaces an objective can move to (P9-T13a). */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly coach: Coach;
  /** Why a new objective may not be written here now, or null (P9-T07b-a). */
  readonly refusal: WritingRefusal | null;
  /** What to say when the filters leave nothing. */
  readonly empty: React.ReactNode;
}) {
  if (cycleId === null || initialTree === null) {
    return (
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {empty}
      </div>
    );
  }
  return (
    <LiveOkrTable
      initialTree={initialTree}
      initialAt={initialAt}
      scope={scope}
      filters={filters}
      cycleId={cycleId}
      level={level}
      canEdit={canEdit}
      canAdminister={canAdminister}
      progressMax={progressMax}
      members={members}
      spaces={spaces}
      coach={coach}
      refusal={refusal}
      empty={empty}
    />
  );
}

type Okr = OkrHandle;

/**
 * The table on the cache (P9-T06c, P9-T07a-a).
 *
 * Every cell change goes through `useOkrMutation`, so the row moves before the
 * server answers and moves back with the server's sentence if it refuses.
 * Adding a row or deleting an objective still re-renders the page, because the
 * header's count and the alignment score above the table are the server's to
 * recompute.
 */
function LiveOkrTable({
  initialTree,
  initialAt,
  scope,
  filters,
  cycleId,
  level,
  canEdit,
  canAdminister,
  progressMax,
  members,
  spaces,
  coach,
  refusal,
  empty,
}: {
  readonly initialTree: OkrTree;
  readonly initialAt: number;
  readonly scope: OkrScope;
  readonly filters: OkrFilters;
  readonly cycleId: string;
  readonly level: GoalLevel;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  /** The spaces an objective can move to (P9-T13a). */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly coach: Coach;
  readonly refusal: WritingRefusal | null;
  readonly empty: React.ReactNode;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  // An add in flight: its own row says so, and the others wait for it.
  const [pending, setPending] = useState(false);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  // The objective just added, whose key result draft opens under it.
  const [draftUnder, setDraftUnder] = useState<string | null>(null);
  // What is being dragged, and the grip the keyboard goes back to after a
  // move, so Alt and an arrow can be pressed again without hunting for it.
  const dragged = useRef<{
    readonly id: string;
    readonly parent: string | null;
  } | null>(null);
  const [regrip, setRegrip] = useState<{ id: string; at: number } | null>(null);
  // Where the dragged row would land: the row it is over, and which side.
  const [hint, setHint] = useState<{
    readonly id: string;
    readonly after: boolean;
  } | null>(null);
  const tree = useOkrTree({
    cycleId,
    scope,
    initial: initialTree,
    initialAt,
  });
  useOkrLive(cycleId);
  const okr = useOkrMutation({ cycleId, scope });
  const drawer = useDrawerAddress();
  // §2.9: once the plan is set, an addition says why where the workspace
  // asks it to, before the write rather than after a refusal.
  const reasonSetting = coach.practice["reasons.midCycleAddition"];
  const askReason =
    tree?.cycle.midCycle && reasonSetting !== "off" ? reasonSetting : null;
  // Any change still on its way to the server. Said on the list itself, so
  // a screen reader hears that a save is under way, and so a test can wait
  // for the server rather than for the row, which moves before it answers.
  const saving = useIsMutating() > 0 || pending;
  // The rows whose change the server has not answered yet.
  const savingIds = usePendingOkrIds();
  const goals = filterGoals(tree.goals, filters);
  const units = unitsInUse(tree.goals);
  const problem = okr.problem;

  useEffect(() => {
    if (!regrip) {
      return;
    }
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-grip="${regrip.id}"]`)
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [regrip]);

  /**
   * A mover for one row of a set. `siblings` is the set as it is on screen:
   * the server places the row after its new neighbour and renumbers the
   * whole set, so a row a filter hides keeps its place there.
   */
  const moverFor = (
    siblings: readonly { readonly id: string }[],
    index: number,
    parent: string | null,
    label: string,
  ): Mover | null => {
    if (!canEdit) {
      return null;
    }
    const id = siblings[index]?.id as string;
    const place = (afterId: string | null) => {
      okr.mutate(
        parent === null
          ? { kind: "placeGoal", id, afterId }
          : { kind: "placeKeyResult", id, afterId },
      );
      setRegrip({ id, at: Date.now() });
    };
    return {
      label,
      move: (by) => {
        if (by < 0 && index > 0) {
          place(siblings[index - 2]?.id ?? null);
        }
        if (by > 0 && index < siblings.length - 1) {
          place(siblings[index + 1]?.id ?? null);
        }
      },
      onDragStart: () => {
        dragged.current = { id, parent };
      },
      onDragEnd: () => {
        dragged.current = null;
        setHint(null);
      },
      accepts: () => {
        const from = dragged.current;
        return from !== null && from.parent === parent && from.id !== id;
      },
      onHover: (after) =>
        setHint((now) =>
          now?.id === id && now.after === after ? now : { id, after },
        ),
      onDrop: (after) => {
        const from = dragged.current;
        dragged.current = null;
        setHint(null);
        if (!from || from.parent !== parent || from.id === id) {
          return;
        }
        const rest = siblings.filter((row) => row.id !== from.id);
        const at = rest.findIndex((row) => row.id === id);
        okr.mutate(
          parent === null
            ? {
                kind: "placeGoal",
                id: from.id,
                afterId: after ? id : (rest[at - 1]?.id ?? null),
              }
            : {
                kind: "placeKeyResult",
                id: from.id,
                afterId: after ? id : (rest[at - 1]?.id ?? null),
              },
        );
      },
    };
  };

  // An add: the draft row keeps its title and shows the sentence on a
  // refusal, and on success the page renders again for the same reason a
  // structural change does.
  const add = async (
    work: () => Promise<{ error: string | null; id?: string | null }>,
  ): Promise<string | null> => {
    setPending(true);
    try {
      const result = await work();
      if (result.error) {
        return result.error;
      }
      await queryClient.invalidateQueries({ queryKey: okrCycleKey(cycleId) });
      router.refresh();
      return null;
    } finally {
      setPending(false);
    }
  };

  const toggle = (id: string) =>
    setCollapsed((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );

  // Key results are open by default, because they are the proof (METHOD.md
  // §1, owner decision Q3). "Collapse all" is remembered in this browser, so
  // somebody who reads objectives only gets that view back.
  const goalIds = goals.map((goal) => goal.id).join(",");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(FOLD_KEY) === "collapsed") {
        setCollapsed(goalIds === "" ? [] : goalIds.split(","));
      }
    } catch {
      // Storage refused: the default, every card open.
    }
  }, [goalIds]);
  const allCollapsed =
    goals.length > 0 && goals.every((goal) => collapsed.includes(goal.id));
  const foldAll = (fold: boolean) => {
    setCollapsed(fold ? goals.map((goal) => goal.id) : []);
    try {
      if (fold) {
        window.localStorage.setItem(FOLD_KEY, "collapsed");
      } else {
        window.localStorage.removeItem(FOLD_KEY);
      }
    } catch {
      // Not remembered, which is the only cost.
    }
  };

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="okr-list"
      aria-busy={saving}
    >
      {problem ? (
        <p role="alert" className="text-xs text-bad">
          {problem}
        </p>
      ) : null}

      {okr.conflict ? (
        <div
          role="alert"
          data-testid="okr-conflict"
          className="flex flex-wrap items-center gap-2 rounded-control border border-warn-dot bg-warn-bg px-3 py-2 text-xs text-ink-2"
        >
          <span className="min-w-0 flex-1">
            {t("okrTree.changedSinceYouRead", {
              name: okr.conflict.conflict.changedBy ?? t("okrTree.somebody"),
              value: Object.values(okr.conflict.conflict.current)
                .map((value) => String(value ?? ""))
                .join(", "),
            })}
          </span>
          <Button type="button" size="sm" onClick={okr.keepMine}>
            {t("okrTree.keepMine")}
          </Button>
          <Button type="button" size="sm" onClick={okr.takeTheirs}>
            {t("okrTree.takeTheirs")}
          </Button>
        </div>
      ) : null}

      {/* **One card per objective**, as the reference mockup (12-okr-home)
       * draws it: the objective's head with its progress across the card,
       * then its key results as rows. It was one table under a column
       * header, where an objective read as one more row and its progress as
       * a short bar in a narrow column (Goals audit, 2 November 2026). Every
       * cell is still edited where it is read. */}
      <div className="flex flex-col gap-3">
        {goals.length > 1 ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="okr-fold-all"
              aria-pressed={allCollapsed}
              onClick={() => foldAll(!allCollapsed)}
            >
              {allCollapsed ? t("okrList.expandAll") : t("okrList.collapseAll")}
            </Button>
          </div>
        ) : null}
        {tree.goals.length === 0 ? (
          <p
            className="rounded-lg border border-line bg-surface p-3 text-sm text-ink-2"
            data-testid="okr-empty-cycle"
          >
            {canEdit ? t("okrList.emptyCycle") : t("okrList.emptyCycleRead")}
          </p>
        ) : goals.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface">
            {empty}
          </div>
        ) : null}

        {/* `j` and `k` walk every objective and key result in order, `e`
         * puts the caret in the row's title (plan 0.7.0, U2). */}
        <KeyboardList edit={canEdit} className="flex flex-col gap-3">
          {goals.map((goal, goalIndex) => {
            const open = !collapsed.includes(goal.id);
            // The whole card takes a dragged objective, not only its head.
            const objectiveMover = moverFor(
              goals,
              goalIndex,
              null,
              t("okrList.moveObjective", { title: goal.title }),
            );
            return (
              <section
                key={goal.id}
                aria-label={goal.title}
                className="relative rounded-xl border border-line bg-surface"
                {...moverHandlers(objectiveMover)}
              >
                <DropLine at={hint?.id === goal.id ? hint.after : null} gap />
                <ObjectiveRow
                  goal={goal}
                  open={open}
                  onToggle={() => toggle(goal.id)}
                  okr={okr}
                  canEdit={canEdit}
                  canAdminister={canAdminister}
                  busy={pending}
                  saving={savingIds.has(goal.id)}
                  progressMax={progressMax}
                  members={members}
                  coach={coach}
                  spaces={spaces}
                  viewerId={tree.viewerId}
                  mover={objectiveMover}
                  onDelete={() =>
                    okr.mutate({ kind: "deleteGoal", id: goal.id })
                  }
                  onOpen={() => drawer.open(goal.id)}
                  onCheckIn={() => drawer.open(goal.id, { tab: "check-in" })}
                />
                {open ? (
                  <>
                    {goal.keyResults.length > 0 ? (
                      // The column names over the rows, so "5 in 10" reads as
                      // a confidence. On a phone only the count stays.
                      <div
                        className={`grid gap-x-3.5 border-y border-line bg-bg py-1.5 pr-3.5 pl-3 text-[11.5px] font-semibold text-ink-3 md:pl-[42px] [&>span:not(:first-child)]:hidden md:[&>span:not(:first-child)]:block ${KEY_RESULT_GRID}`}
                      >
                        <span>
                          {t("okrList.keyResultsBand", {
                            count: goal.keyResults.length,
                          })}
                        </span>
                        <span>{t("goals.editor.columnValue")}</span>
                        <span>{t("goals.editor.columnProgress")}</span>
                        <span>{t("okrDrawer.confidenceLabel")}</span>
                        <span />
                      </div>
                    ) : null}
                    {goal.keyResults.map((keyResult, keyResultIndex) => (
                      <KeyResultRow
                        key={keyResult.id}
                        dropAt={hint?.id === keyResult.id ? hint.after : null}
                        mover={moverFor(
                          goal.keyResults,
                          keyResultIndex,
                          goal.id,
                          t("okrList.moveKeyResult", {
                            title: keyResult.title,
                          }),
                        )}
                        keyResult={keyResult}
                        units={units}
                        cycle={tree.cycle}
                        onOpen={() =>
                          drawer.open(goal.id, { keyResultId: keyResult.id })
                        }
                        okr={okr}
                        canEdit={canEdit}
                        canAdminister={canAdminister}
                        saving={savingIds.has(keyResult.id)}
                        progressMax={progressMax}
                        members={members}
                        coach={coach}
                      />
                    ))}
                    {canEdit ? (
                      <AddRow
                        label={t("goals.editor.addKeyResult")}
                        placeholder={t("goals.editor.keyResultPlaceholder")}
                        disabled={pending}
                        indented
                        // An objective just added opens with one key result
                        // draft under it (design §4.3).
                        initiallyOpen={draftUnder === goal.id}
                        askReason={askReason}
                        onAdd={(title, reason) =>
                          add(() =>
                            addKeyResult({
                              goalId: goal.id,
                              title,
                              ownerId: goal.champion.id,
                              dueOn: tree.cycle.endsOn,
                              ...(reason ? { reason } : {}),
                            }),
                          )
                        }
                      />
                    ) : null}
                  </>
                ) : null}
              </section>
            );
          })}
        </KeyboardList>

        {canEdit ? (
          <div className="overflow-hidden rounded-lg border border-dashed border-line-2 bg-surface [&>*]:border-b-0">
            <AddRow
              label={t("goals.editor.addObjective")}
              placeholder={t("goals.editor.objectivePlaceholder")}
              disabled={pending}
              refusal={refusal}
              askReason={askReason}
              onAdd={(title, reason) =>
                add(async () => {
                  const created = await addObjective({
                    cycleId,
                    level,
                    title,
                    ...(reason ? { reason } : {}),
                  });
                  if (created.id) {
                    setDraftUnder(created.id);
                  }
                  return created;
                })
              }
            />
          </div>
        ) : null}
      </div>

      {/* The whole tree, not the filtered rows: a filter hides a row, and a
       * link to an objective it hides still opens it. */}
      <OkrDrawer
        tree={tree}
        okr={okr}
        canEdit={canEdit}
        canAdminister={canAdminister}
        progressMax={progressMax}
        members={members}
        spaces={spaces}
        coach={coach}
      />
    </div>
  );
}

/** A refused change on this row: what was typed, why, and a second try. */
function Refused({ okr, id }: { readonly okr: Okr; readonly id: string }) {
  const { t } = useTranslations();
  if (okr.failed?.mutation.id !== id) {
    return null;
  }
  return (
    <div
      role="alert"
      data-testid="okr-refused"
      className="flex flex-wrap items-center gap-2 border-b border-line bg-bad-bg px-3.5 py-1.5 pl-11 text-xs text-bad"
    >
      <span className="min-w-0 flex-1">
        {t("okrList.notSaved", { error: okr.failed.error })}
      </span>
      <button
        type="button"
        onClick={okr.retry}
        className="rounded-control px-2 py-0.5 font-semibold text-brand-text"
      >
        {t("okrList.retry")}
      </button>
      <button
        type="button"
        onClick={okr.discard}
        className="rounded-control px-2 py-0.5 text-ink-3"
      >
        {t("okrList.discard")}
      </button>
    </div>
  );
}

function ObjectiveRow({
  goal,
  open,
  spaces,
  viewerId,
  onToggle,
  okr,
  canEdit,
  canAdminister,
  busy,
  saving,
  progressMax,
  members,
  coach,
  mover,
  onDelete,
  onOpen,
  onCheckIn,
}: {
  readonly goal: OkrGoal;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly okr: Okr;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly busy: boolean;
  /** A change to this objective is still on its way to the server. */
  readonly saving: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  readonly coach: Coach;
  /** The spaces an objective can move to (P9-T13a). */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  /** Who is reading, so a waiting draft offers its step to the right person. */
  readonly viewerId: string;
  readonly mover: Mover | null;
  readonly onDelete: () => void;
  readonly onOpen: () => void;
  readonly onCheckIn: () => void;
}) {
  const { t, locale } = useTranslations();
  const cells = useObjectiveCells(goal, okr, coach);

  return (
    <>
      {/* The objective's head: the grip in the same column and at the same
          place as a key result's, the title with its meta line, the health
          chip, the actions and the collapse on the right, the rule note,
          then the progress across the card. The grip sat on the card's own
          border and the chevron where a key result has its grip, which made
          the two rows' left edges disagree (Goals, 2 November 2026). */}
      <div
        data-keyboard-row
        className="group relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 py-3 pr-3.5 pl-3 md:grid-cols-[1.5rem_minmax(0,1fr)_auto] md:pl-2.5"
      >
        <span className="hidden h-6 items-center justify-center md:flex">
          {mover ? <Grip id={goal.id} mover={mover} /> : null}
        </span>

        <span data-keyboard-edit className="contents">
          <InlineText
            value={goal.title}
            label={t("goals.editor.objectiveTitle")}
            wrap
            maxLength={500}
            readOnly={!canEdit}
            bold
            textClass="text-[14.5px] leading-snug font-bold tracking-[-0.1px]"
            onDraft={cells.onDraft}
            onSave={cells.saveTitle}
          />
        </span>

        <div
          className="col-start-2 row-start-1 flex items-center gap-1 md:col-start-3"
          aria-busy={saving || undefined}
        >
          {saving ? <Spinner /> : null}
          <span className="hidden md:inline-flex">
            <HealthChip health={goal.health} reported={goal.reportedStatus} />
          </span>
          <RowActions
            title={goal.title}
            href={`/goals/${goal.id}`}
            onOpen={onOpen}
            // The row's check-in opens the drawer on its check-in tab (§4.4),
            // for somebody who may change the objective, while it is open.
            onCheckIn={canEdit && goal.closedAt === null ? onCheckIn : null}
            openLabel={t("goals.editor.openObjective")}
            deleteLabel={t("goals.editor.deleteObjective")}
            canDelete={canAdminister && !busy}
            onDelete={onDelete}
            // §2.9's stop, for an open objective somebody may change.
            stop={
              canEdit && goal.closedAt === null && !busy
                ? {
                    label: t("okrList.stopObjective", { title: goal.title }),
                    run: (reason) =>
                      okr.mutate({ kind: "stopGoal", id: goal.id, reason }),
                  }
                : null
            }
          />
          {/* Last on the right, where a collapsible card keeps it. */}
          <Tooltip
            label={
              open ? t("okrList.hideKeyResults") : t("okrList.showKeyResults")
            }
          >
            <button
              type="button"
              aria-expanded={open}
              aria-label={t("goals.editor.toggleKeyResults", {
                title: goal.title,
              })}
              onClick={onToggle}
              className="flex size-6.5 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink"
            >
              <Chevron open={open} />
            </button>
          </Tooltip>
        </div>

        <div data-text-first className={`col-start-1 md:col-start-2 ${META}`}>
          {/* On a phone the health chip leads the meta line instead. */}
          <span className="md:hidden" data-phone-only>
            <HealthChip
              health={goal.health}
              reported={goal.reportedStatus}
              testId="health-chip-phone"
            />
          </span>
          <span>
            <KindControl
              kind={goal.kind}
              title={goal.title}
              kinds={okrKindsInUse(coach.practice)}
              // A closed objective keeps the kind it was closed as.
              readOnly={!canEdit || goal.closedAt !== null}
              onSave={cells.saveKind}
            />
          </span>
          <span>
            <AddedMidCycle at={goal.addedMidCycleAt} />
          </span>
          <span>
            <AdditionDraftMark draft={goal.draft} />
          </span>
          <span>
            <WaitingDraft
              state={goal.draftState}
              title={goal.title}
              canPublish={canEdit && goal.champion.id === viewerId}
              canApprove={canEdit && goal.reviewer?.id === viewerId}
              busy={busy}
              onPublish={() =>
                okr.mutate({ kind: "publishDraft", id: goal.id })
              }
              onApprove={() =>
                okr.mutate({ kind: "approveDraft", id: goal.id })
              }
            />
          </span>
          {/* §2.9: the space it belongs to, and the move to another. */}
          {goal.spaceId !== null ? (
            <span className="inline-flex items-center gap-1">
              {t("okrDrawer.space")}
              <SpacePicker
                value={goal.spaceId}
                spaces={spaces}
                label={t("okrList.spaceOf", { title: goal.title })}
                readOnly={!canEdit || goal.closedAt !== null || busy}
                onSave={(spaceId) =>
                  okr.mutate({ kind: "moveToSpace", id: goal.id, spaceId })
                }
              />
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            {t("okrList.champion")}
            <Avatar
              name={goal.champion.name}
              size="sm"
              className="ml-0.5 size-4 text-[7px]"
            />
            <MemberPicker
              value={goal.champion}
              members={members}
              label={t("okrList.championOf", { title: goal.title })}
              // Naming the champion is administering the goal (full).
              readOnly={!canAdminister}
              onSave={cells.saveChampion}
            />
          </span>
          <span>
            {goal.reviewer ? (
              <>
                {t("okrDrawer.reviewer")}{" "}
                <span className="text-ink-2">{goal.reviewer.name}</span>
                {/* Warned, never refused (okr-core-domain.md §4.1, plan
                 * 0.7.0 O3). Short here; the drawer says it in full. */}
                {reviewerIsChampion(goal.champion.id, goal.reviewer.id) ? (
                  <Chip
                    className="ml-1 h-4.5 bg-warn-bg text-[11px] text-warn"
                    data-testid="reviewer-is-champion-chip"
                  >
                    {t("okrList.reviewerIsChampion")}
                  </Chip>
                ) : null}
              </>
            ) : (
              t("okrList.noReviewer")
            )}
          </span>
          {goal.nextCheckInOn ? (
            <span>
              {t("okrList.nextCheckIn", {
                date: dayLabel(goal.nextCheckInOn, locale),
              })}
            </span>
          ) : null}
        </div>

        {cells.verdicts.length > 0 ? (
          <div className="col-span-2 col-start-1 md:col-start-2">
            <VerdictChips verdicts={cells.verdicts} />
          </div>
        ) : null}

        {/* The objective's progress across the card: the one number the
            card is about. */}
        <div className="col-span-2 col-start-1 flex items-center gap-2.5 md:col-start-2">
          <Bar
            value={goal.progressPct}
            max={progressMax}
            label={goal.title}
            className="h-2 flex-1"
          />
          <span className="w-10 text-right text-[13px] font-bold tabular-nums text-ink">
            {Math.round(goal.progressPct)}%
          </span>
        </div>
      </div>
      <Refused okr={okr} id={goal.id} />
    </>
  );
}

function KeyResultRow({
  dropAt,
  keyResult,
  onOpen,
  okr,
  canEdit,
  canAdminister,
  saving,
  progressMax,
  members,
  coach,
  mover,
  units,
  cycle,
}: {
  /** Where a dragged key result would land: above, below, or not here. */
  readonly dropAt: boolean | null;
  readonly keyResult: OkrGoal["keyResults"][number];
  readonly onOpen: () => void;
  readonly okr: Okr;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  /** A change to this key result is still on its way to the server. */
  readonly saving: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  readonly coach: Coach;
  readonly mover: Mover | null;
  /** The units the cycle already uses, for the unit cell to offer. */
  readonly units: readonly string[];
  /** The cycle's dates, which a due date outside of is warned about. */
  readonly cycle: { readonly startsOn: string; readonly endsOn: string };
}) {
  const { t } = useTranslations();
  const cells = useKeyResultCells(keyResult, okr, coach);
  const patch = cells.patch;
  // A value a KPI supplies is the KPI's to change, not this cell's (§4.2).
  const fromKpi = keyResult.kpiId !== null;

  const band =
    keyResult.confidence === null
      ? null
      : confidenceBand(keyResult.confidence, coach.thresholds).band;

  return (
    <>
      {/* Wide: title and meta, value, progress, confidence, actions. On a
          phone: the title with the menu beside it, the value and the
          confidence under it, then the progress across. */}
      <div
        data-keyboard-row
        className={`group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 border-b border-line py-2.5 pr-3.5 pl-3 hover:bg-bg md:pl-2.5 ${KEY_RESULT_GRID}`}
        {...moverHandlers(mover)}
      >
        <DropLine at={dropAt} />
        {/* Flex rather than grid: the row is the nearest grid, which is how
            a row is found from its title. */}
        <div className="col-start-1 row-start-1 flex min-w-0 gap-x-2 md:col-start-auto md:row-start-auto">
          <span className="hidden h-5 w-6 flex-none items-center justify-center md:flex">
            {mover ? <Grip id={keyResult.id} mover={mover} /> : null}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span data-keyboard-edit className="contents">
              <InlineText
                value={keyResult.title}
                label={t("goals.editor.keyResultTitle")}
                wrap
                maxLength={500}
                readOnly={!canEdit}
                textClass="text-[13px] leading-snug font-medium"
                onDraft={cells.onDraft}
                onSave={(title) => patch({ title }, { title: keyResult.title })}
              />
            </span>
            <VerdictChips verdicts={cells.verdicts} />
            <div data-text-first className={`text-[11.5px] ${META}`}>
              <span>
                <KeyResultKindPicker
                  kind={keyResult.kind}
                  title={keyResult.title}
                  kinds={keyResultKindsInUse(coach.practice)}
                  readOnly={!canEdit || fromKpi}
                  onSave={cells.saveKind}
                />
              </span>
              <span>
                <AddedMidCycle at={keyResult.addedMidCycleAt} />
              </span>
              <span>
                <AdditionDraftMark draft={keyResult.draft} />
              </span>
              <span className="inline-flex items-center gap-1">
                {keyResult.owner ? (
                  <Avatar
                    name={keyResult.owner.name}
                    size="sm"
                    className="size-4 text-[7px]"
                  />
                ) : null}
                <MemberPicker
                  value={keyResult.owner}
                  members={members}
                  label={t("okrList.ownerOf", { title: keyResult.title })}
                  readOnly={!canEdit}
                  allowNone
                  onSave={(ownerId) =>
                    patch({ ownerId }, { ownerId: keyResult.owner?.id ?? null })
                  }
                />
              </span>
              <span className="inline-flex items-baseline gap-1">
                {t("okrList.due")}
                <InlineDate
                  value={keyResult.dueOn}
                  label={t("okrList.dueOf", { title: keyResult.title })}
                  readOnly={!canEdit}
                  cycle={cycle}
                  asText
                  onSave={(dueOn) =>
                    patch({ dueOn }, { dueOn: keyResult.dueOn })
                  }
                />
              </span>
              {fromKpi ? (
                <span className="text-[11px] text-info">
                  {t("common.fromAKpi")}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="col-start-1 row-start-2 md:col-start-auto md:row-start-auto">
          {keyResult.kind === "milestone" ? (
            // §2.10: a milestone asks one question, done or not done.
            <DoneToggle
              done={keyResult.doneAt !== null}
              title={keyResult.title}
              readOnly={!canEdit}
              onSave={cells.saveDone}
            />
          ) : keyResult.kind === "baseline" ? (
            // §2.10: a baseline is recorded by its first value, which then
            // reads as the value it found.
            <span
              data-text-first
              className="flex flex-col gap-0.5 text-[13px] font-semibold tabular-nums"
            >
              <span className="text-[11px] font-medium text-ink-4">
                {keyResult.doneAt === null
                  ? t("keyResultKind.recordBaseline")
                  : t("keyResultKind.baseline")}
              </span>
              <InlineNumber
                value={
                  keyResult.doneAt === null ? null : keyResult.currentValue
                }
                label={t("keyResultKind.baselineFor", {
                  title: keyResult.title,
                })}
                readOnly={!canEdit || fromKpi}
                onSave={cells.saveValue}
              />
            </span>
          ) : (
            <div
              data-text-first
              className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums md:flex-col md:gap-0.5"
            >
              <span className="flex items-baseline gap-1 text-[13px] font-semibold text-ink">
                <InlineNumber
                  value={keyResult.currentValue}
                  label={t("goals.editor.valueFor", { title: keyResult.title })}
                  readOnly={!canEdit || fromKpi}
                  onSave={cells.saveValue}
                />
                <span className="font-medium text-ink-4">/</span>
                <InlineNumber
                  key={cells.targetCell}
                  value={keyResult.targetValue}
                  label={t("okrList.targetOf", { title: keyResult.title })}
                  readOnly={!canEdit}
                  onSave={cells.saveTarget}
                />
                <span className="font-medium text-ink-3">
                  <InlineUnit
                    value={keyResult.unit ?? ""}
                    label={t("okrList.unitOf", { title: keyResult.title })}
                    readOnly={!canEdit}
                    known={units}
                    placeholder={t("okrList.unit")}
                    onSave={(unit) =>
                      patch(
                        { unit: unit === "" ? null : unit },
                        { unit: keyResult.unit },
                      )
                    }
                  />
                </span>
              </span>
              <span className="flex items-baseline gap-1 text-[11px] text-ink-4">
                {keyResult.kind === "maintain"
                  ? t("keyResultKind.band")
                  : t("okrList.from")}
                <InlineNumber
                  value={keyResult.baselineValue}
                  label={t("okrList.baselineOf", { title: keyResult.title })}
                  readOnly={!canEdit}
                  onSave={(baselineValue) =>
                    patch(
                      { baselineValue },
                      { baselineValue: keyResult.baselineValue },
                    )
                  }
                />
              </span>
            </div>
          )}
        </div>

        <div className="col-span-2 row-start-3 flex items-center gap-2 md:col-span-1 md:row-start-auto">
          <Bar
            value={keyResult.progressPct}
            max={progressMax}
            label={keyResult.title}
            className="h-1.5 flex-1"
          />
          <span className="w-9 text-right text-xs font-semibold tabular-nums text-ink-2">
            {Math.round(keyResult.progressPct)}%
          </span>
        </div>

        <span className="col-start-2 row-start-2 inline-flex items-center gap-1.5 justify-self-end text-xs whitespace-nowrap text-ink-2 tabular-nums md:col-start-auto md:row-start-auto md:justify-self-start">
          {band ? (
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${CONFIDENCE_DOT[band]}`}
            />
          ) : null}
          {canEdit ? (
            // Set here between check-ins (okr-writing.md §4.2, plan 0.7.0 O4).
            <InlineConfidence
              value={keyResult.confidence}
              label={t("okrList.confidenceOf", { title: keyResult.title })}
              display={coach.practice["confidence.display"]}
              onSave={cells.saveConfidence}
            />
          ) : keyResult.confidence === null ? (
            t("okrList.noConfidence")
          ) : (
            formatConfidence(
              keyResult.confidence,
              coach.practice["confidence.display"],
              t,
            )
          )}
        </span>

        <div
          className="col-start-2 row-start-1 flex items-center justify-end gap-1 self-start md:col-start-auto md:row-start-auto md:self-center"
          aria-busy={saving || undefined}
        >
          {saving ? <Spinner /> : null}
          <RowActions
            title={keyResult.title}
            href={`/goals/${keyResult.goalId}#kr-${keyResult.id}`}
            onOpen={onOpen}
            openLabel={t("goals.editor.openKeyResult")}
            deleteLabel={t("goals.editor.deleteKeyResult")}
            canDelete={canAdminister}
            onDelete={() =>
              okr.mutate({ kind: "removeKeyResult", id: keyResult.id })
            }
          />
        </div>
      </div>
      {cells.easing !== null && keyResult.targetValue !== null ? (
        <ReasonField
          from={keyResult.targetValue}
          to={cells.easing}
          onSave={cells.saveReason}
          onCancel={cells.cancelReason}
        />
      ) : null}
      <Refused okr={okr} id={keyResult.id} />
    </>
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
 * Open and delete, shown on hover and always reachable with the keyboard.
 *
 * `opacity-0` with `focus-within:opacity-100`, never `hidden`: a control that
 * only a mouse can reveal is a control a keyboard cannot use, which is the
 * half of the accessibility gate a scan cannot answer.
 *
 * **Open puts the objective in the drawer** (P9-T08a) rather than leaving the
 * list for its page, so the reader keeps their place; the drawer links to the
 * page for everything it does not hold. It stays a link to that page, so a
 * new tab, a middle click or a copied address still reaches the page itself,
 * and only a plain click is taken over.
 */
function RowActions({
  title,
  href,
  onOpen,
  onCheckIn = null,
  openLabel,
  deleteLabel,
  canDelete,
  onDelete,
  stop = null,
}: {
  /** The row's title, which names its menu. */
  readonly title: string;
  readonly href: string;
  readonly onOpen: () => void;
  /** Objectives only; null where the reader may not check in. */
  readonly onCheckIn?: (() => void) | null;
  readonly openLabel: string;
  readonly deleteLabel: string;
  readonly canDelete: boolean;
  readonly onDelete: () => void;
  /**
   * Objectives only: stopping one that no longer matters, with its one-line
   * reason (METHOD.md §2.9, P9-T13-c-a). Null where it cannot be stopped.
   */
  readonly stop?: {
    readonly label: string;
    readonly run: (reason: string) => void;
  } | null;
}) {
  const { t } = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [reason, setReason] = useState("");

  if (stopping && stop) {
    const send = () => {
      if (reason.trim() === "") {
        return;
      }
      stop.run(reason.trim());
      setStopping(false);
      setReason("");
    };
    return (
      <div className="flex items-center justify-end gap-1">
        <TextInput
          // The reason is the whole point of the control, so it takes the
          // focus the moment the control opens.
          ref={focusOnMount}
          value={reason}
          maxLength={280}
          label={t("okrList.stopReason")}
          hideLabel
          placeholder={t("okrList.stopReason")}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
            if (event.key === "Escape") {
              setStopping(false);
              setReason("");
            }
          }}
          className="w-56"
          inputClassName="h-7 px-2 text-xs"
        />
        <Button
          type="button"
          size="sm"
          disabled={reason.trim() === ""}
          onClick={send}
        >
          {t("okrList.stopConfirm")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setStopping(false);
            setReason("");
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>
    );
  }

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

  const icon =
    "flex size-6.5 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink";
  const item =
    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 outline-none data-[highlighted]:bg-brand-weak data-[highlighted]:text-brand-text";

  // Check in and open stay one press away; stopping and deleting, which
  // change the plan, wait behind the menu (Goals revamp, 2 November 2026).
  // The row's controls show on hover or focus, and always on a phone.
  return (
    <div className="flex items-center justify-end gap-0.5 opacity-100 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[data-popup-open]]:opacity-100 md:opacity-0">
      {onCheckIn ? (
        <Tooltip label={t("okrList.checkInOn")}>
          <button
            type="button"
            aria-label={t("okrList.checkInOn")}
            onClick={onCheckIn}
            className={`hidden md:flex ${icon}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
              className="size-3.5"
            >
              <path d="m5 12 5 5 9-10" />
            </svg>
          </button>
        </Tooltip>
      ) : null}
      <Tooltip label={openLabel}>
        <a
          // Where `j` and `k` land in the row, rather than the grip or the
          // title field, which would take the next `j` as typing (U2).
          data-keyboard-focus
          href={href}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            onOpen();
          }}
          className={`hidden md:flex ${icon}`}
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
            <path d="M7 17 17 7M8 7h9v9" />
          </svg>
        </a>
      </Tooltip>
      <Menu.Root>
        <Tooltip label={t("okrList.moreActionsShort")}>
          <Menu.Trigger
            aria-label={t("okrList.moreActions", { title })}
            className={icon}
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="size-3.5"
            >
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </Menu.Trigger>
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4} align="end">
            <Menu.Popup className="min-w-44 rounded-lg border border-line-2 bg-surface p-1 shadow-(--shadow-popover)">
              <Menu.Item className={item} onClick={onOpen}>
                {openLabel}
              </Menu.Item>
              {onCheckIn ? (
                <Menu.Item className={item} onClick={onCheckIn}>
                  {t("okrList.checkInOn")}
                </Menu.Item>
              ) : null}
              {stop ? (
                <Menu.Item
                  className={item}
                  aria-label={stop.label}
                  // After the menu has closed, which hands the focus back to
                  // its trigger and would take it from the reason field.
                  onClick={() => window.setTimeout(() => setStopping(true), 50)}
                >
                  {t("okrList.stopThisObjective")}
                </Menu.Item>
              ) : null}
              {canDelete ? (
                <>
                  <Menu.Separator className="my-1 h-px bg-line" />
                  <Menu.Item
                    className={`${item} text-bad data-[highlighted]:bg-bad-bg data-[highlighted]:text-bad`}
                    onClick={() => setConfirming(true)}
                  >
                    {deleteLabel}
                  </Menu.Item>
                </>
              ) : null}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

/**
 * A draft row under a set (design §4.3).
 *
 * It is a link-looking button until it is pressed, then a field held in the
 * browser: **nothing is written until a title is committed**, and Escape on
 * it removes the draft with nothing left behind, which is the difference
 * between this and the spreadsheet it is modelled on.
 *
 * **A refusal keeps what was typed** (P9-T07b-a). The server's sentence sits
 * under the field and the title stays in it, so a workspace that holds
 * writing back costs the reader nothing they typed (UIUX-PLAN §1.7, "Never
 * lose work").
 */
function AddRow({
  label,
  placeholder,
  disabled,
  indented,
  initiallyOpen,
  refusal,
  askReason,
  onAdd,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly indented?: boolean;
  /** Open on arrival: the key result draft under an objective just added. */
  readonly initiallyOpen?: boolean;
  /** Where the workspace holds writing back, the reason instead of a field. */
  readonly refusal?: WritingRefusal | null;
  /**
   * Whether what is added now is started mid-cycle and the workspace asks
   * why (METHOD.md §2.9, P9-T13-a): a second line, which a required reason
   * must fill before Save.
   */
  readonly askReason?: "optional" | "required" | null;
  /** Resolves to the server's refusal, or null once it is saved. */
  readonly onAdd: (title: string, reason?: string) => Promise<string | null>;
}) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(initiallyOpen === true);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // On a phone the key results have no grip column, so the add row
  // starts where their titles do.
  const padding = indented ? "pl-3 md:pl-11" : "pl-3.5";

  const close = () => {
    setTitle("");
    setReason("");
    setProblem(null);
    setOpen(false);
  };

  const needsReason = askReason === "required" && reason.trim() === "";
  const commit = async () => {
    const wanted = title.trim();
    if (wanted === "" || saving || needsReason) {
      return;
    }
    setSaving(true);
    const refused = await onAdd(
      wanted,
      askReason && reason.trim() !== "" ? reason.trim() : undefined,
    );
    setSaving(false);
    if (refused) {
      setProblem(refused);
      return;
    }
    close();
  };

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

  if (refusal) {
    return (
      <div className={`border-b border-line py-2 pr-3.5 ${padding}`}>
        <RestrictedWriting refusal={refusal} onClose={close} />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-1 border-b border-line py-2 pr-3.5 ${padding}`}
    >
      <div className="flex items-center gap-2">
        <TextInput
          // Focused through a ref rather than `autoFocus`: the field exists
          // because somebody just pressed the control that creates it, so the
          // caret belongs here, and the attribute that does it declaratively
          // also steals focus when a page loads with one of these already open.
          ref={focusOnMount}
          value={title}
          label={label}
          hideLabel
          maxLength={500}
          placeholder={placeholder}
          disabled={saving}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void commit();
            }
            if (event.key === "Escape") {
              close();
            }
          }}
          className="min-w-0 flex-1"
          inputClassName="h-6.5 px-2 text-xs"
        />
        <Button
          type="button"
          size="sm"
          disabled={disabled || title.trim() === "" || needsReason}
          pending={saving}
          onClick={() => void commit()}
        >
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" onClick={close}>
          {t("common.cancel")}
        </Button>
      </div>
      {askReason ? (
        // §2.9: after the plan is set, a start says why it starts now.
        <TextInput
          value={reason}
          label={
            askReason === "required"
              ? t("midCycle.whyNowRequired")
              : t("midCycle.whyNowOptional")
          }
          hideLabel
          maxLength={500}
          placeholder={t("midCycle.whyNowPlaceholder")}
          disabled={saving}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void commit();
            }
            if (event.key === "Escape") {
              close();
            }
          }}
          className="min-w-0"
          inputClassName="h-6.5 px-2 text-xs"
        />
      ) : null}
      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
