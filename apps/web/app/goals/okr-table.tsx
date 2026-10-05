"use client";

import type { GoalLevel } from "@openokr/db";
import {
  applyEnforcement,
  evaluateKeyResults,
  evaluateObjective,
  isEasing,
  type ResolvedPractice,
  type ResolvedThresholds,
} from "@openokr/method";
import {
  Bar,
  Button,
  useIsMutating,
  useQueryClient,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  filterGoals,
  type OkrFilters,
  type OkrGoal,
  type OkrScope,
  type OkrTree,
  okrCycleKey,
} from "../../lib/okr-tree/cache.ts";
import {
  useOkrLive,
  useOkrMutation,
  useOkrTree,
} from "../../lib/okr-tree/use-okr-tree.ts";
import {
  addKeyResult,
  addObjective,
  type EditorResult,
  removeGoal,
} from "./editor-actions.ts";
import { HealthChip } from "./health-chip.tsx";
import {
  InlineDate,
  InlineNumber,
  InlineText,
  MemberPicker,
  type Person,
  ReasonField,
  type ShownVerdict,
  VerdictChips,
} from "./okr-cells.tsx";

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
 * the unit and the due date. The cells are in `okr-cells.tsx`.
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

/** What the coaching chips judge by: this workspace's numbers and practice. */
export interface Coach {
  readonly thresholds: ResolvedThresholds;
  readonly practice: ResolvedPractice;
}

const GRID = "md:grid-cols-[1.5rem_minmax(0,1fr)_13rem_8rem_6.5rem_4rem]";

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
      empty={empty}
    />
  );
}

type Okr = ReturnType<typeof useOkrMutation>;

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
  readonly empty: React.ReactNode;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const tree = useOkrTree({
    cycleId,
    scope,
    initial: initialTree,
    initialAt,
  });
  useOkrLive(cycleId);
  const okr = useOkrMutation({ cycleId, scope });
  // Any change still on its way to the server. Said on the list itself, so
  // a screen reader hears that a save is under way, and so a test can wait
  // for the server rather than for the row, which moves before it answers.
  const saving = useIsMutating() > 0 || pending;
  const goals = filterGoals(tree.goals, filters);
  const problem = failure ?? okr.problem;

  // A structural change: the page's own count and score move with it, so the
  // server renders again, and the cache is told to re-read either way.
  const run = (work: () => Promise<EditorResult>) => {
    setFailure(null);
    start(async () => {
      const result = await work();
      if (result.error) {
        setFailure(result.error);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: okrCycleKey(cycleId) });
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

        {goals.map((goal) => {
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
                onDelete={() => run(() => removeGoal({ id: goal.id }))}
              />
              {open ? (
                <>
                  {goal.keyResults.map((keyResult) => (
                    <KeyResultRow
                      key={keyResult.id}
                      keyResult={keyResult}
                      goalHref={`/goals/${goal.id}`}
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

        {canEdit ? (
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

/** Whether the strict mode the server judges by is on, for the coaching. */
function strictFor(coach: Coach): boolean {
  return (
    coach.practice.strictMode === "on" ||
    coach.thresholds["quality.coachStrictness"] === "strict"
  );
}

/** The checks that judge an objective's wording, against a draft title. */
function objectiveVerdicts(
  title: string,
  goal: OkrGoal,
  coach: Coach,
): ShownVerdict[] {
  return applyEnforcement(
    evaluateObjective(
      {
        title,
        hasCycle: goal.cycleId !== null,
        hasTimeframe: false,
        championId: goal.champion.id,
        reviewerId: goal.reviewer?.id ?? null,
        reviewerRequired: coach.practice.reviewer === "required",
        objectivesInUnit: 1,
        level: goal.level,
      },
      coach.thresholds,
    ),
    coach.practice,
    { strict: strictFor(coach) },
  ).filter(
    (verdict) =>
      (verdict.id === "OBJ-1" || verdict.id === "OBJ-2") &&
      verdict.status !== "pass",
  );
}

/** The checks that judge one key result's wording, against a draft title. */
function keyResultVerdicts(
  text: string,
  keyResult: OkrGoal["keyResults"][number],
  coach: Coach,
): ShownVerdict[] {
  return applyEnforcement(
    evaluateKeyResults(
      {
        keyResults: [
          {
            text,
            baseline: keyResult.baselineValue,
            target: keyResult.targetValue,
            dueOn: keyResult.dueOn,
            ownerId: keyResult.owner?.id ?? null,
            indicatorType: keyResult.indicatorType,
            direction: keyResult.direction,
            confidence: keyResult.confidence,
          },
        ],
      },
      coach.thresholds,
    ),
    coach.practice,
    { strict: strictFor(coach) },
  ).filter(
    (verdict) =>
      (verdict.id === "KR-2" || verdict.id === "KR-5") &&
      verdict.status !== "pass" &&
      verdict.keyResults.includes(0),
  );
}

/** The stored verdicts, at rest: the checks this row failed when last saved. */
function storedVerdicts(flags: readonly string[]): ShownVerdict[] {
  return flags.map((id) => ({ id, status: "fail", prompt: id }));
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
  onToggle,
  okr,
  canEdit,
  canAdminister,
  busy,
  progressMax,
  members,
  coach,
  onDelete,
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
  readonly onDelete: () => void;
}) {
  const { t } = useTranslations();
  const [draft, setDraft] = useState<string | null>(null);
  const verdicts = useMemo(
    () =>
      draft === null
        ? storedVerdicts(
            goal.quality.flags.filter((id) => id.startsWith("OBJ-")),
          )
        : objectiveVerdicts(draft, goal, coach),
    [draft, goal, coach],
  );

  return (
    <>
      <div
        className={`group grid grid-cols-[1.5rem_1fr] items-center gap-2.5 border-b border-line px-3.5 py-2 hover:bg-bg ${GRID}`}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={t("goals.editor.toggleKeyResults", { title: goal.title })}
          onClick={onToggle}
          className="flex size-5 items-center justify-center rounded-control text-ink-4 hover:bg-raised hover:text-ink-2"
        >
          <Chevron open={open} />
        </button>

        <div className="flex min-w-0 flex-col">
          <InlineText
            value={goal.title}
            label={t("goals.editor.objectiveTitle")}
            readOnly={!canEdit}
            bold
            onDraft={setDraft}
            onSave={(title) =>
              okr.mutate({
                kind: "patchGoal",
                id: goal.id,
                set: { title },
                read: { title: goal.title },
              })
            }
          />
          <VerdictChips verdicts={verdicts} />
          <span className="flex flex-wrap items-center gap-x-2 px-1.5 text-[11px] text-ink-3">
            <span className="flex items-center gap-1">
              {t("okrList.champion")}
              <MemberPicker
                value={goal.champion}
                members={members}
                label={t("okrList.championOf", { title: goal.title })}
                // Naming the champion is administering the goal (full).
                readOnly={!canAdminister}
                onSave={(championId) => {
                  if (championId) {
                    okr.mutate({
                      kind: "patchGoal",
                      id: goal.id,
                      set: { championId },
                      read: { championId: goal.champion.id },
                    });
                  }
                }}
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
          openLabel={t("goals.editor.openObjective")}
          deleteLabel={t("goals.editor.deleteObjective")}
          canDelete={canAdminister && !busy}
          onDelete={onDelete}
        />
      </div>
      <Refused okr={okr} id={goal.id} />
    </>
  );
}

function KeyResultRow({
  keyResult,
  goalHref,
  okr,
  canEdit,
  canAdminister,
  progressMax,
  members,
  coach,
}: {
  readonly keyResult: OkrGoal["keyResults"][number];
  readonly goalHref: string;
  readonly okr: Okr;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  readonly coach: Coach;
}) {
  const { t } = useTranslations();
  const [draft, setDraft] = useState<string | null>(null);
  // The eased target waiting for its reason, and a counter that puts the
  // target cell back to the stored value when the reader thinks again.
  const [easing, setEasing] = useState<number | null>(null);
  const [targetCell, setTargetCell] = useState(0);
  const verdicts = useMemo(
    () =>
      draft === null
        ? storedVerdicts(keyResult.qualityFlags)
        : keyResultVerdicts(draft, keyResult, coach),
    [draft, keyResult, coach],
  );
  const reasonRequired = coach.practice["reasons.easingTarget"] === "required";
  const patch = (
    set: Parameters<Okr["mutate"]>[0] extends infer M
      ? M extends { kind: "patchKeyResult"; set: infer S }
        ? S
        : never
      : never,
    read: Record<string, string | number | null>,
  ) => okr.mutate({ kind: "patchKeyResult", id: keyResult.id, set, read });

  return (
    <>
      <div
        className={`group grid grid-cols-[1.5rem_1fr] items-center gap-2.5 border-b border-line px-3.5 py-1.5 hover:bg-bg ${GRID}`}
      >
        <span />
        <div className="flex min-w-0 flex-col pl-3">
          <InlineText
            value={keyResult.title}
            label={t("goals.editor.keyResultTitle")}
            readOnly={!canEdit}
            onDraft={setDraft}
            onSave={(title) => patch({ title }, { title: keyResult.title })}
          />
          <VerdictChips verdicts={verdicts} />
          <span className="flex flex-wrap items-center gap-x-2 px-1.5 text-[11px] text-ink-3">
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
          </span>
        </div>

        <div className="flex flex-col gap-0.5 text-xs tabular-nums">
          <span className="flex items-center gap-1">
            <InlineNumber
              value={keyResult.currentValue}
              label={t("goals.editor.valueFor", { title: keyResult.title })}
              readOnly={!canEdit}
              onSave={(value) =>
                okr.mutate({ kind: "recordValue", id: keyResult.id, value })
              }
            />
            <span className="text-ink-4">/</span>
            <InlineNumber
              key={targetCell}
              value={keyResult.targetValue}
              label={t("okrList.targetOf", { title: keyResult.title })}
              readOnly={!canEdit}
              onSave={(targetValue) => {
                if (
                  reasonRequired &&
                  isEasing({
                    from: keyResult.targetValue,
                    to: targetValue,
                    baseline: keyResult.baselineValue,
                  })
                ) {
                  setEasing(targetValue);
                  return;
                }
                okr.mutate({
                  kind: "changeTarget",
                  id: keyResult.id,
                  targetValue,
                });
              }}
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
            {t("okrList.from")}
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
          href={goalHref}
          openLabel={t("goals.editor.openKeyResult")}
          deleteLabel={t("goals.editor.deleteKeyResult")}
          canDelete={canAdminister}
          onDelete={() =>
            okr.mutate({ kind: "removeKeyResult", id: keyResult.id })
          }
        />
      </div>
      {easing !== null ? (
        <ReasonField
          from={keyResult.targetValue}
          to={easing}
          onSave={(reason) => {
            okr.mutate({
              kind: "changeTarget",
              id: keyResult.id,
              targetValue: easing,
              reason,
            });
            setEasing(null);
          }}
          onCancel={() => {
            setEasing(null);
            setTargetCell((count) => count + 1);
          }}
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
