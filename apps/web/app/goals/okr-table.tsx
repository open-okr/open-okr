"use client";

import type { GoalLevel } from "@openokr/db";
import { keyResultKindsInUse, okrKindsInUse } from "@openokr/method";
import {
  Bar,
  Button,
  Chip,
  useIsMutating,
  useQueryClient,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
} from "../../lib/okr-tree/use-okr-tree.ts";
import { addKeyResult, addObjective } from "./editor-actions.ts";
import { HealthChip } from "./health-chip.tsx";
import {
  AddedMidCycle,
  AdditionDraftMark,
  DoneToggle,
  InlineDate,
  InlineNumber,
  InlineText,
  KeyResultKindPicker,
  KindControl,
  MemberPicker,
  type Person,
  ReasonField,
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

const GRID = "md:grid-cols-[2.75rem_minmax(0,1fr)_13rem_8rem_6.5rem_5rem]";

/**
 * Moving one row of a set (P9-T07b-b, design §4.4): Alt with an arrow key
 * anywhere in the row, or the grip dragged onto another row of the same set.
 * Null for a reader who cannot edit, who gets no grip at all.
 */
interface Mover {
  readonly label: string;
  readonly move: (by: -1 | 1) => void;
  readonly onDragStart: () => void;
  /** Dropped on this row, in its lower half when `after`. */
  readonly onDrop: (after: boolean) => void;
}

/** What the row does with Alt and an arrow, a drag over it and a drop. */
function moverHandlers(mover: Mover | null) {
  if (!mover) {
    return {};
  }
  return {
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!event.altKey) {
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        mover.move(-1);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        mover.move(1);
      }
    },
    onDragOver: (event: React.DragEvent<HTMLDivElement>) =>
      event.preventDefault(),
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      mover.onDrop(event.clientY > box.top + box.height / 2);
    },
  };
}

/**
 * The grip: dragged to move the row, and the place the keyboard is put back
 * after a move so Alt and an arrow can be pressed again. Hidden until the
 * row is hovered or the grip is focused, never removed, so a keyboard always
 * reaches it.
 */
function Grip({ id, mover }: { readonly id: string; readonly mover: Mover }) {
  return (
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
  );
}

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
  const goals = filterGoals(tree.goals, filters);
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
      onDrop: (after) => {
        const from = dragged.current;
        dragged.current = null;
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

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div
          className={`hidden items-center gap-2.5 border-b border-line bg-bg px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-3 md:grid ${GRID}`}
        >
          <span />
          <span>{t("goals.editor.columnName")}</span>
          <span>{t("goals.editor.columnValue")}</span>
          <span>{t("goals.editor.columnProgress")}</span>
          <span>{t("okrList.columnStatus")}</span>
          <span />
        </div>

        {tree.goals.length === 0 ? (
          <p className="p-3 text-sm text-ink-2" data-testid="okr-empty-cycle">
            {canEdit ? t("okrList.emptyCycle") : t("okrList.emptyCycleRead")}
          </p>
        ) : goals.length === 0 ? (
          empty
        ) : null}

        {goals.map((goal, goalIndex) => {
          const open = !collapsed.includes(goal.id);
          return (
            <div key={goal.id}>
              <ObjectiveRow
                goal={goal}
                open={open}
                onToggle={() => toggle(goal.id)}
                okr={okr}
                canEdit={canEdit}
                canAdminister={canAdminister}
                busy={pending}
                progressMax={progressMax}
                members={members}
                coach={coach}
                viewerId={tree.viewerId}
                mover={moverFor(
                  goals,
                  goalIndex,
                  null,
                  t("okrList.moveObjective", { title: goal.title }),
                )}
                onDelete={() => okr.mutate({ kind: "deleteGoal", id: goal.id })}
                onOpen={() => drawer.open(goal.id)}
                onCheckIn={() => drawer.open(goal.id, { tab: "check-in" })}
              />
              {open ? (
                <>
                  {goal.keyResults.map((keyResult, keyResultIndex) => (
                    <KeyResultRow
                      key={keyResult.id}
                      mover={moverFor(
                        goal.keyResults,
                        keyResultIndex,
                        goal.id,
                        t("okrList.moveKeyResult", { title: keyResult.title }),
                      )}
                      keyResult={keyResult}
                      onOpen={() =>
                        drawer.open(goal.id, { keyResultId: keyResult.id })
                      }
                      okr={okr}
                      canEdit={canEdit}
                      canAdminister={canAdminister}
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
            </div>
          );
        })}

        {canEdit ? (
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
  viewerId,
  onToggle,
  okr,
  canEdit,
  canAdminister,
  busy,
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
  readonly progressMax: number;
  readonly members: readonly Person[];
  readonly coach: Coach;
  /** Who is reading, so a waiting draft offers its step to the right person. */
  readonly viewerId: string;
  readonly mover: Mover | null;
  readonly onDelete: () => void;
  readonly onOpen: () => void;
  readonly onCheckIn: () => void;
}) {
  const { t } = useTranslations();
  const cells = useObjectiveCells(goal, okr, coach);

  return (
    <>
      <div
        className={`group grid grid-cols-[2.75rem_1fr] items-center gap-2.5 border-b border-line px-3.5 py-2 hover:bg-bg ${GRID}`}
        {...moverHandlers(mover)}
      >
        <span className="flex items-center">
          {mover ? (
            <Grip id={goal.id} mover={mover} />
          ) : (
            <span className="size-5" />
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-label={t("goals.editor.toggleKeyResults", {
              title: goal.title,
            })}
            onClick={onToggle}
            className="flex size-5 items-center justify-center rounded-control text-ink-4 hover:bg-raised hover:text-ink-2"
          >
            <Chevron open={open} />
          </button>
        </span>

        <div className="flex min-w-0 flex-col">
          <InlineText
            value={goal.title}
            label={t("goals.editor.objectiveTitle")}
            readOnly={!canEdit}
            bold
            onDraft={cells.onDraft}
            onSave={cells.saveTitle}
          />
          <VerdictChips verdicts={cells.verdicts} />
          <span className="flex flex-wrap items-center gap-x-2 px-1.5 text-[11px] text-ink-3">
            <KindControl
              kind={goal.kind}
              title={goal.title}
              kinds={okrKindsInUse(coach.practice)}
              // A closed objective keeps the kind it was closed as.
              readOnly={!canEdit || goal.closedAt !== null}
              onSave={cells.saveKind}
            />
            <AddedMidCycle at={goal.addedMidCycleAt} />
            <AdditionDraftMark draft={goal.draft} />
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
            <span className="flex items-center gap-1">
              {t("okrList.champion")}
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
              {goal.reviewer
                ? t("okrList.reviewer", { name: goal.reviewer.name })
                : t("okrList.noReviewer")}
            </span>
            {goal.nextCheckInOn ? (
              <span>
                {t("okrList.nextCheckIn", { date: goal.nextCheckInOn })}
              </span>
            ) : null}
          </span>
        </div>

        <span className="hidden text-xs text-ink-4 md:block" />

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
      </div>
      <Refused okr={okr} id={goal.id} />
    </>
  );
}

function KeyResultRow({
  keyResult,
  onOpen,
  okr,
  canEdit,
  canAdminister,
  progressMax,
  members,
  coach,
  mover,
}: {
  readonly keyResult: OkrGoal["keyResults"][number];
  readonly onOpen: () => void;
  readonly okr: Okr;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  readonly coach: Coach;
  readonly mover: Mover | null;
}) {
  const { t } = useTranslations();
  const cells = useKeyResultCells(keyResult, okr, coach);
  const patch = cells.patch;
  // A value a KPI supplies is the KPI's to change, not this cell's (§4.2).
  const fromKpi = keyResult.kpiId !== null;

  return (
    <>
      <div
        className={`group grid grid-cols-[2.75rem_1fr] items-center gap-2.5 border-b border-line px-3.5 py-1.5 hover:bg-bg ${GRID}`}
        {...moverHandlers(mover)}
      >
        <span className="flex justify-end">
          {mover ? <Grip id={keyResult.id} mover={mover} /> : null}
        </span>
        <div className="flex min-w-0 flex-col pl-3">
          <InlineText
            value={keyResult.title}
            label={t("goals.editor.keyResultTitle")}
            readOnly={!canEdit}
            onDraft={cells.onDraft}
            onSave={(title) => patch({ title }, { title: keyResult.title })}
          />
          <VerdictChips verdicts={cells.verdicts} />
          <span className="flex flex-wrap items-center gap-x-2 px-1.5 text-[11px] text-ink-3">
            <KeyResultKindPicker
              kind={keyResult.kind}
              title={keyResult.title}
              kinds={keyResultKindsInUse(coach.practice)}
              readOnly={!canEdit || fromKpi}
              onSave={cells.saveKind}
            />
            <AddedMidCycle at={keyResult.addedMidCycleAt} />
            <AdditionDraftMark draft={keyResult.draft} />
            <span className="flex items-center gap-1">
              {t("okrList.owner")}
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
            <span className="flex items-center gap-1">
              {t("okrList.due")}
              <InlineDate
                value={keyResult.dueOn}
                label={t("okrList.dueOf", { title: keyResult.title })}
                readOnly={!canEdit}
                onSave={(dueOn) => patch({ dueOn }, { dueOn: keyResult.dueOn })}
              />
            </span>
            {fromKpi ? <Chip tone="info">{t("common.fromAKpi")}</Chip> : null}
          </span>
        </div>

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
          <span className="flex flex-col gap-0.5 text-xs tabular-nums">
            <span className="text-[11px] text-ink-4">
              {keyResult.doneAt === null
                ? t("keyResultKind.recordBaseline")
                : t("keyResultKind.baseline")}
            </span>
            <InlineNumber
              value={keyResult.doneAt === null ? null : keyResult.currentValue}
              label={t("keyResultKind.baselineFor", { title: keyResult.title })}
              readOnly={!canEdit || fromKpi}
              onSave={cells.saveValue}
            />
          </span>
        ) : (
          <div className="flex flex-col gap-0.5 text-xs tabular-nums">
            <span className="flex items-center gap-1">
              <InlineNumber
                value={keyResult.currentValue}
                label={t("goals.editor.valueFor", { title: keyResult.title })}
                readOnly={!canEdit || fromKpi}
                onSave={cells.saveValue}
              />
              <span className="text-ink-4">/</span>
              <InlineNumber
                key={cells.targetCell}
                value={keyResult.targetValue}
                label={t("okrList.targetOf", { title: keyResult.title })}
                readOnly={!canEdit}
                onSave={cells.saveTarget}
              />
              <InlineText
                value={keyResult.unit ?? ""}
                label={t("okrList.unitOf", { title: keyResult.title })}
                readOnly={!canEdit}
                allowEmpty
                placeholder={t("okrList.unit")}
                onSave={(unit) =>
                  patch(
                    { unit: unit === "" ? null : unit },
                    { unit: keyResult.unit },
                  )
                }
              />
            </span>
            <span className="flex items-center gap-1 text-[11px] text-ink-4">
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

        <span className="hidden text-xs tabular-nums text-ink-3 md:block">
          {keyResult.confidence === null
            ? t("okrList.noConfidence")
            : t("okrList.confidence", {
                value: String(Math.round(keyResult.confidence * 10)),
              })}
        </span>

        <RowActions
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
  href,
  onOpen,
  onCheckIn = null,
  openLabel,
  deleteLabel,
  canDelete,
  onDelete,
  stop = null,
}: {
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
        <input
          // The reason is the whole point of the control, so it takes the
          // focus the moment the control opens.
          // biome-ignore lint/a11y/noAutofocus: opened by the reader's own press, to type the one thing it asks.
          autoFocus
          value={reason}
          maxLength={280}
          aria-label={t("okrList.stopReason")}
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
          className="h-7 w-56 rounded-control border border-line bg-surface px-2 text-xs"
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

  return (
    <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 hover:opacity-100">
      {onCheckIn ? (
        <button
          type="button"
          aria-label={t("okrList.checkInOn")}
          onClick={onCheckIn}
          className="flex size-6 items-center justify-center rounded-control text-ink-4 hover:bg-raised hover:text-ink-2"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="size-3.5"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </button>
      ) : null}
      <a
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
      {stop ? (
        <button
          type="button"
          aria-label={stop.label}
          onClick={() => setStopping(true)}
          className="flex size-6 items-center justify-center rounded-control text-ink-4 hover:bg-raised hover:text-ink-2"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="size-3.5"
          >
            <circle cx="12" cy="12" r="9" />
            <rect x="9" y="9" width="6" height="6" />
          </svg>
        </button>
      ) : null}
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

  const padding = indented ? "pl-11" : "pl-3.5";

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
        <input
          // Focused through a ref rather than `autoFocus`: the field exists
          // because somebody just pressed the control that creates it, so the
          // caret belongs here, and the attribute that does it declaratively
          // also steals focus when a page loads with one of these already open.
          ref={(node) => node?.focus()}
          value={title}
          aria-label={label}
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
          className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
        />
        <Button
          type="button"
          size="sm"
          disabled={disabled || saving || title.trim() === "" || needsReason}
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
        <input
          value={reason}
          aria-label={
            askReason === "required"
              ? t("midCycle.whyNowRequired")
              : t("midCycle.whyNowOptional")
          }
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
          className="min-w-0 rounded-control border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
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
