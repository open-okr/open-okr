"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { Tabs } from "@base-ui-components/react/tabs";
import { keyResultKindsInUse, okrKindsInUse } from "@openokr/method";
import {
  Bar,
  Chip,
  formatMeasure,
  useQueryClient,
  useToast,
  useTranslations,
} from "@openokr/ui";
import { X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { OkrDetail } from "../../lib/okr-tree/actions.ts";
import {
  OKR_DETAIL_ALL,
  type OkrGoal,
  type OkrTree,
  okrCycleKey,
} from "../../lib/okr-tree/cache.ts";
import {
  type OkrHandle,
  useOkrDetail,
} from "../../lib/okr-tree/use-okr-tree.ts";
import { unlinkGoals } from "./alignment-actions.ts";
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
  SpacePicker,
  VerdictChips,
  WaitingDraft,
} from "./okr-cells.tsx";
import { CheckInTab } from "./okr-check-in.tsx";
import {
  type Coach,
  useKeyResultCells,
  useObjectiveCells,
} from "./okr-editing.ts";

/**
 * The OKR drawer (P9-T08a, docs/design/p9-t00-okr-writing.md §6).
 *
 * One objective opened beside the list, with everything the row has no room
 * for: every field of the objective and its key results, the value and target
 * history, the check-ins, and where it sits in the alignment. The list and,
 * from P9-T09, the diagram open the same drawer, and it **reads and writes
 * through the same cache** as they do, so a value changed here moves the
 * row behind it the moment it is typed.
 *
 * **It lives in the address.** `okr` names the objective, `tab` the tab and
 * `kr` a key result to bring into view, so a link to an objective's history
 * is a link, and the browser's Back closes what Forward opened. The address
 * changes through the history API rather than a navigation, so opening the
 * drawer does not render the page again on the server.
 *
 * **Not modal.** The list stays usable beside it, which is the point of a
 * drawer rather than a page: a reader checks a row against the history
 * without losing either. Escape closes it, except in a field, where Escape
 * puts the field back and the drawer stays.
 */

const DRAWER_TABS = ["details", "check-in", "history", "alignment"] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number];

/** Each tab's name, spelled out so the catalogue check can find every key. */
const TAB_LABEL: Readonly<Record<DrawerTab, string>> = {
  details: "okrDrawer.tab.details",
  "check-in": "okrDrawer.tab.checkIn",
  history: "okrDrawer.tab.history",
  alignment: "okrDrawer.tab.alignment",
};

/** The drawer's place in the address, and the three ways to change it. */
export function useDrawerAddress() {
  const params = useSearchParams();
  const goalId = params.get("okr");
  const asked = params.get("tab");
  const tab: DrawerTab =
    DRAWER_TABS.find((entry) => entry === asked) ?? "details";
  const keyResultId = params.get("kr");

  const write = (
    patch: Readonly<Record<string, string | null>>,
    how: "push" | "replace",
  ) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    const query = next.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (how === "push") {
      window.history.pushState(null, "", url);
    } else {
      window.history.replaceState(null, "", url);
    }
  };

  return {
    goalId,
    tab,
    keyResultId,
    /** Opening is a step Back can undo; switching objectives is not. */
    open: (
      id: string,
      options: { readonly tab?: DrawerTab; readonly keyResultId?: string } = {},
    ) =>
      write(
        {
          okr: id,
          tab: options.tab && options.tab !== "details" ? options.tab : null,
          kr: options.keyResultId ?? null,
        },
        goalId === null ? "push" : "replace",
      ),
    choose: (next: DrawerTab) =>
      write({ tab: next === "details" ? null : next }, "replace"),
    close: () => write({ okr: null, tab: null, kr: null }, "replace"),
  };
}

/** Whether the keyboard is in a field, where Escape belongs to the field. */
function editing(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  );
}

export function OkrDrawer({
  tree,
  okr,
  canEdit,
  canAdminister,
  progressMax,
  members,
  spaces,
  coach,
}: {
  /** The cycle's whole tree, unfiltered: a filter hides rows, not objectives. */
  readonly tree: OkrTree;
  readonly okr: OkrHandle;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  /** The spaces an objective can move to (P9-T13a). */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly coach: Coach;
}) {
  const { t } = useTranslations();
  const address = useDrawerAddress();
  const goal =
    address.goalId === null
      ? null
      : (tree.goals.find((entry) => entry.id === address.goalId) ?? null);

  return (
    <Dialog.Root
      open={address.goalId !== null}
      modal={false}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (open) {
          return;
        }
        if (details.reason === "escape-key" && editing()) {
          return;
        }
        if (
          details.reason === "escape-key" ||
          details.reason === "close-press"
        ) {
          address.close();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup
          data-testid="okr-drawer"
          // Below the toasts (z-50), so an undo stays reachable over it.
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-lg outline-none"
        >
          <header className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
              {goal?.title ?? t("okrDrawer.missingTitle")}
            </Dialog.Title>
            {goal ? (
              <a
                href={`/goals/${goal.id}`}
                className="flex-none text-xs font-semibold text-brand-text hover:underline"
              >
                {t("okrDrawer.fullPage")}
              </a>
            ) : null}
            <Dialog.Close
              aria-label={t("okrDrawer.close")}
              className="flex size-7 flex-none items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </header>
          {goal ? (
            <DrawerBody
              key={goal.id}
              goal={goal}
              tree={tree}
              tab={address.tab}
              keyResultId={address.keyResultId}
              onTab={address.choose}
              onOpen={(id) => address.open(id, { tab: address.tab })}
              okr={okr}
              canEdit={canEdit}
              canAdminister={canAdminister}
              progressMax={progressMax}
              members={members}
              spaces={spaces}
              coach={coach}
            />
          ) : (
            <p
              className="p-4 text-sm text-ink-2"
              data-testid="okr-drawer-missing"
            >
              {t("okrDrawer.missing")}
            </p>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerBody({
  goal,
  tree,
  tab,
  keyResultId,
  onTab,
  onOpen,
  okr,
  canEdit,
  canAdminister,
  progressMax,
  members,
  spaces,
  coach,
}: {
  readonly goal: OkrGoal;
  readonly tree: OkrTree;
  readonly tab: DrawerTab;
  readonly keyResultId: string | null;
  readonly onTab: (tab: DrawerTab) => void;
  readonly onOpen: (goalId: string) => void;
  readonly okr: OkrHandle;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  /** The spaces an objective can move to (P9-T13a). */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly coach: Coach;
}) {
  const { t } = useTranslations();
  const toast = useToast();
  // Checking in is for somebody who may change the objective, while it is
  // open; anybody else asked for that tab by a link gets the details.
  const canCheckIn = canEdit && goal.closedAt === null;
  const shown: DrawerTab = tab === "check-in" && !canCheckIn ? "details" : tab;
  const tabs = DRAWER_TABS.filter(
    (entry) => entry !== "check-in" || canCheckIn,
  );
  // Read only for the tabs that show it: the details are the cache's.
  const detail = useOkrDetail(goal, shown !== "details");
  const objective = useObjectiveCells(goal, okr, coach);

  // A key result named in the address is brought into view once it is drawn.
  useEffect(() => {
    if (keyResultId && tab === "details") {
      document
        .getElementById(`drawer-kr-${keyResultId}`)
        ?.scrollIntoView({ block: "center" });
    }
  }, [keyResultId, tab]);

  return (
    <Tabs.Root
      value={shown}
      onValueChange={(value) => onTab(value as DrawerTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <Tabs.List className="flex flex-none gap-1 border-b border-line px-4">
        {tabs.map((entry) => (
          <Tabs.Tab
            key={entry}
            value={entry}
            className="-mb-px border-b-2 border-transparent px-2 py-2 text-xs font-semibold text-ink-3 hover:text-ink data-active:border-brand data-active:text-ink"
          >
            {t(TAB_LABEL[entry])}
          </Tabs.Tab>
        ))}
      </Tabs.List>

      <Refused okr={okr} ids={[goal.id, ...goal.keyResults.map((k) => k.id)]} />

      <Tabs.Panel
        value="details"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      >
        <section className="flex flex-col gap-2">
          <InlineText
            value={goal.title}
            label={t("goals.editor.objectiveTitle")}
            readOnly={!canEdit}
            bold
            onDraft={objective.onDraft}
            onSave={objective.saveTitle}
          />
          <VerdictChips verdicts={objective.verdicts} />
          <AddedMidCycle at={goal.addedMidCycleAt} />
          <AdditionDraftMark draft={goal.draft} />
          <WaitingDraft
            state={goal.draftState}
            title={goal.title}
            canPublish={canEdit && goal.champion.id === tree.viewerId}
            canApprove={canEdit && goal.reviewer?.id === tree.viewerId}
            busy={okr.pending}
            onPublish={() => okr.mutate({ kind: "publishDraft", id: goal.id })}
            onApprove={() => okr.mutate({ kind: "approveDraft", id: goal.id })}
          />
          <div className="flex items-center gap-2">
            <Bar
              value={goal.progressPct}
              max={progressMax}
              label={goal.title}
              className="flex-1"
            />
            <span className="text-xs font-semibold tabular-nums text-ink-3">
              {Math.round(goal.progressPct)}%
            </span>
            <HealthChip health={goal.health} reported={goal.reportedStatus} />
          </div>
          <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-ink-3">{t("okrList.champion")}</dt>
            <dd>
              <MemberPicker
                value={goal.champion}
                members={members}
                label={t("okrList.championOf", { title: goal.title })}
                readOnly={!canAdminister}
                onSave={objective.saveChampion}
              />
            </dd>
            <dt className="text-ink-3">{t("okrDrawer.reviewer")}</dt>
            <dd className="px-1 text-ink-2">
              {goal.reviewer?.name ?? t("okrList.noReviewer")}
            </dd>
            <dt className="text-ink-3">{t("okrDrawer.level")}</dt>
            <dd className="px-1 text-ink-2">{goal.level}</dd>
            {/* §2.9: a team that merges or splits takes its OKRs with it. */}
            <dt className="text-ink-3">{t("okrDrawer.space")}</dt>
            <dd>
              <SpacePicker
                value={goal.spaceId}
                spaces={spaces}
                label={t("okrList.spaceOf", { title: goal.title })}
                readOnly={!canEdit || goal.closedAt !== null}
                onSave={(spaceId) =>
                  okr.mutate({ kind: "moveToSpace", id: goal.id, spaceId })
                }
              />
            </dd>
            {/* §2.8. Absent where the workspace uses one kind. */}
            {okrKindsInUse(coach.practice).length > 1 ? (
              <>
                <dt className="text-ink-3">{t("okrKind.label")}</dt>
                <dd className="px-1">
                  <KindControl
                    kind={goal.kind}
                    title={goal.title}
                    kinds={okrKindsInUse(coach.practice)}
                    readOnly={!canEdit || goal.closedAt !== null}
                    onSave={objective.saveKind}
                  />
                </dd>
              </>
            ) : null}
            <dt className="text-ink-3">{t("okrDrawer.nextCheckIn")}</dt>
            <dd className="px-1 text-ink-2">
              {goal.nextCheckInOn ?? t("okrDrawer.noCheckInDue")}
            </dd>
            <dt className="text-ink-3">{t("common.whatItContributesTo")}</dt>
            <dd>
              <InlineText
                value={goal.contributionStatement ?? ""}
                label={t("common.whatItContributesTo")}
                readOnly={!canEdit}
                allowEmpty
                placeholder={t("common.thePriorityThisMoves")}
                onSave={(statement) =>
                  okr.mutate({
                    kind: "patchGoal",
                    id: goal.id,
                    set: {
                      contributionStatement:
                        statement === "" ? null : statement,
                    },
                    read: {
                      contributionStatement: goal.contributionStatement,
                    },
                  })
                }
              />
            </dd>
            <dt className="text-ink-3">{t("goals.detail.weight")}</dt>
            <dd>
              <InlineNumber
                value={goal.weight}
                label={t("okrDrawer.weightOf", { title: goal.title })}
                readOnly={!canEdit}
                onSave={(weight) =>
                  okr.mutate({
                    kind: "patchGoal",
                    id: goal.id,
                    set: { weight },
                    read: { weight: goal.weight },
                  })
                }
              />
            </dd>
          </dl>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
            {t("okrDrawer.keyResults", { count: goal.keyResults.length })}
          </h3>
          {goal.keyResults.length === 0 ? (
            <p className="text-xs text-ink-3">{t("okrDrawer.noKeyResults")}</p>
          ) : (
            goal.keyResults.map((keyResult) => (
              <DrawerKeyResult
                key={keyResult.id}
                keyResult={keyResult}
                highlighted={keyResult.id === keyResultId}
                okr={okr}
                canEdit={canEdit}
                progressMax={progressMax}
                members={members}
                coach={coach}
              />
            ))
          )}
        </section>
      </Tabs.Panel>

      {canCheckIn ? (
        <Tabs.Panel
          value="check-in"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
        >
          <Loaded detail={detail}>
            {(loaded) => (
              <CheckInTab
                goal={goal}
                detail={loaded}
                okr={okr}
                thresholds={coach.thresholds}
                onPublished={() => {
                  toast.show({ tone: "ok", message: t("okrDrawer.checkedIn") });
                  onTab("history");
                }}
              />
            )}
          </Loaded>
        </Tabs.Panel>
      ) : null}

      <Tabs.Panel
        value="history"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      >
        <Loaded detail={detail}>
          {(loaded) => <History goal={goal} detail={loaded} />}
        </Loaded>
      </Tabs.Panel>

      <Tabs.Panel
        value="alignment"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      >
        <Loaded detail={detail}>
          {(loaded) => (
            <Alignment
              goal={goal}
              tree={tree}
              detail={loaded}
              canEdit={canEdit}
              onOpen={onOpen}
            />
          )}
        </Loaded>
      </Tabs.Panel>
    </Tabs.Root>
  );
}

/** A refused change in the drawer: why, and a second try, as the row has. */
function Refused({
  okr,
  ids,
}: {
  readonly okr: OkrHandle;
  readonly ids: readonly string[];
}) {
  const { t } = useTranslations();
  const failed = okr.failed;
  const conflict = okr.conflict;
  if (conflict && ids.includes(conflict.mutation.id)) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 border-b border-line bg-warn-bg px-4 py-2 text-xs text-ink-2"
      >
        <span className="min-w-0 flex-1">
          {t("okrTree.changedSinceYouRead", {
            name: conflict.conflict.changedBy ?? t("okrTree.somebody"),
            value: Object.values(conflict.conflict.current)
              .map((value) => String(value ?? ""))
              .join(", "),
          })}
        </span>
        <button
          type="button"
          onClick={okr.keepMine}
          className="rounded-control px-2 py-0.5 font-semibold text-brand-text"
        >
          {t("okrTree.keepMine")}
        </button>
        <button
          type="button"
          onClick={okr.takeTheirs}
          className="rounded-control px-2 py-0.5 text-ink-3"
        >
          {t("okrTree.takeTheirs")}
        </button>
      </div>
    );
  }
  if (!failed || !ids.includes(failed.mutation.id)) {
    return null;
  }
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 border-b border-line bg-bad-bg px-4 py-2 text-xs text-bad"
    >
      <span className="min-w-0 flex-1">
        {t("okrList.notSaved", { error: failed.error })}
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

function DrawerKeyResult({
  keyResult,
  highlighted,
  okr,
  canEdit,
  progressMax,
  members,
  coach,
}: {
  readonly keyResult: OkrGoal["keyResults"][number];
  readonly highlighted: boolean;
  readonly okr: OkrHandle;
  readonly canEdit: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  readonly coach: Coach;
}) {
  const { t } = useTranslations();
  const cells = useKeyResultCells(keyResult, okr, coach);
  const title = keyResult.title;
  // A value a KPI supplies is the KPI's to change, not this field's.
  const fromKpi = keyResult.kpiId !== null;

  return (
    <article
      id={`drawer-kr-${keyResult.id}`}
      aria-label={title}
      className={`flex flex-col gap-1.5 rounded-lg border p-2.5 ${highlighted ? "border-brand bg-brand-weak" : "border-line"}`}
    >
      <InlineText
        value={title}
        label={t("okrDrawer.keyResultTitleOf", { title })}
        readOnly={!canEdit}
        onDraft={cells.onDraft}
        onSave={(next) => cells.patch({ title: next }, { title })}
      />
      <VerdictChips verdicts={cells.verdicts} />
      <AddedMidCycle at={keyResult.addedMidCycleAt} />
      <AdditionDraftMark draft={keyResult.draft} />
      <div className="flex items-center gap-2">
        <Bar
          value={keyResult.progressPct}
          max={progressMax}
          label={title}
          className="flex-1"
        />
        <span className="text-xs font-semibold tabular-nums text-ink-3">
          {Math.round(keyResult.progressPct)}%
        </span>
        <span className="text-xs tabular-nums text-ink-3">
          {keyResult.confidence === null
            ? t("okrList.noConfidence")
            : t("okrList.confidence", {
                value: String(Math.round(keyResult.confidence * 10)),
              })}
        </span>
      </div>
      <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-1 text-xs">
        {/* §2.10's kind decides which of the rows below it asks for. */}
        <dt className="text-ink-3">{t("okrKind.label")}</dt>
        <dd>
          <KeyResultKindPicker
            kind={keyResult.kind}
            title={title}
            kinds={keyResultKindsInUse(coach.practice)}
            readOnly={!canEdit || fromKpi}
            onSave={cells.saveKind}
          />
        </dd>
        {keyResult.kind === "milestone" ? (
          <>
            <dt className="text-ink-3">{t("keyResultKind.milestone")}</dt>
            <dd>
              <DoneToggle
                done={keyResult.doneAt !== null}
                title={title}
                readOnly={!canEdit}
                onSave={cells.saveDone}
              />
            </dd>
          </>
        ) : null}
        {keyResult.kind === "baseline" ? (
          <>
            <dt className="text-ink-3">
              {keyResult.doneAt === null
                ? t("keyResultKind.recordBaseline")
                : t("keyResultKind.baseline")}
            </dt>
            <dd>
              <InlineNumber
                value={
                  keyResult.doneAt === null ? null : keyResult.currentValue
                }
                label={t("keyResultKind.baselineFor", { title })}
                readOnly={!canEdit || fromKpi}
                wide
                onSave={cells.saveValue}
              />
            </dd>
          </>
        ) : null}
        {keyResult.kind === "metric" || keyResult.kind === "maintain" ? (
          <>
            <dt className="text-ink-3">{t("okrDrawer.value")}</dt>
            <dd className="flex items-center gap-1">
              <InlineNumber
                value={keyResult.currentValue}
                label={t("goals.editor.valueFor", { title })}
                readOnly={!canEdit || fromKpi}
                wide
                onSave={cells.saveValue}
              />
              {fromKpi ? <Chip tone="info">{t("common.fromAKpi")}</Chip> : null}
            </dd>
            <dt className="text-ink-3">{t("okrDrawer.target")}</dt>
            <dd className="flex items-center gap-1">
              <InlineNumber
                key={cells.targetCell}
                value={keyResult.targetValue}
                label={t("okrList.targetOf", { title })}
                readOnly={!canEdit}
                wide
                onSave={cells.saveTarget}
              />
              <InlineText
                value={keyResult.unit ?? ""}
                label={t("okrList.unitOf", { title })}
                readOnly={!canEdit}
                allowEmpty
                placeholder={t("okrList.unit")}
                onSave={(unit) =>
                  cells.patch(
                    { unit: unit === "" ? null : unit },
                    { unit: keyResult.unit },
                  )
                }
              />
            </dd>
            <dt className="text-ink-3">
              {keyResult.kind === "maintain"
                ? t("keyResultKind.band")
                : t("okrDrawer.baseline")}
            </dt>
            <dd>
              <InlineNumber
                value={keyResult.baselineValue}
                label={t("okrList.baselineOf", { title })}
                readOnly={!canEdit}
                wide
                onSave={(baselineValue) =>
                  cells.patch(
                    { baselineValue },
                    { baselineValue: keyResult.baselineValue },
                  )
                }
              />
            </dd>
          </>
        ) : null}
        <dt className="text-ink-3">{t("okrList.owner")}</dt>
        <dd>
          <MemberPicker
            value={keyResult.owner}
            members={members}
            label={t("okrList.ownerOf", { title })}
            readOnly={!canEdit}
            allowNone
            onSave={(ownerId) =>
              cells.patch({ ownerId }, { ownerId: keyResult.owner?.id ?? null })
            }
          />
        </dd>
        <dt className="text-ink-3">{t("okrList.due")}</dt>
        <dd>
          <InlineDate
            value={keyResult.dueOn}
            label={t("okrList.dueOf", { title })}
            readOnly={!canEdit}
            onSave={(dueOn) =>
              cells.patch({ dueOn }, { dueOn: keyResult.dueOn })
            }
          />
        </dd>
        <dt className="text-ink-3">{t("goals.detail.weight")}</dt>
        <dd>
          <InlineNumber
            value={keyResult.weight}
            label={t("okrDrawer.weightOf", { title })}
            readOnly={!canEdit}
            onSave={(weight) =>
              cells.patch({ weight }, { weight: keyResult.weight })
            }
          />
        </dd>
      </dl>
      {cells.easing !== null && keyResult.targetValue !== null ? (
        <ReasonField
          from={keyResult.targetValue}
          to={cells.easing}
          inset={false}
          onSave={cells.saveReason}
          onCancel={cells.cancelReason}
        />
      ) : null}
    </article>
  );
}

/** The loading, refused and loaded states of the drawer's own read. */
function Loaded({
  detail,
  children,
}: {
  readonly detail: ReturnType<typeof useOkrDetail>;
  readonly children: (detail: OkrDetail) => React.ReactNode;
}) {
  const { t } = useTranslations();
  if (detail.data) {
    return <>{children(detail.data)}</>;
  }
  if (detail.isError) {
    return (
      <div role="alert" className="flex items-center gap-2 text-xs text-bad">
        <span>{t("okrDrawer.couldNotLoad")}</span>
        <button
          type="button"
          onClick={() => void detail.refetch()}
          className="rounded-control px-2 py-0.5 font-semibold text-brand-text"
        >
          {t("okrList.retry")}
        </button>
      </div>
    );
  }
  // Skeleton lines at the final layout, so nothing jumps when it lands.
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="h-3 w-1/3 rounded bg-raised motion-safe:animate-pulse" />
      <span className="h-3 w-2/3 rounded bg-raised motion-safe:animate-pulse" />
      <span className="h-3 w-1/2 rounded bg-raised motion-safe:animate-pulse" />
    </div>
  );
}

const STATUS = {
  on_track: { tone: "ok", label: "common.onTrack" },
  caution: { tone: "warn", label: "common.caution" },
  off_track: { tone: "bad", label: "common.offTrack" },
} as const;

function History({
  goal,
  detail,
}: {
  readonly goal: OkrGoal;
  readonly detail: OkrDetail;
}) {
  const { t } = useTranslations();
  return (
    <>
      <section
        className="flex flex-col gap-2"
        aria-labelledby="drawer-check-ins"
      >
        <h3
          id="drawer-check-ins"
          className="text-[10px] font-bold uppercase tracking-wider text-ink-3"
        >
          {t("okrDrawer.checkIns")}
        </h3>
        {detail.checkIns.length === 0 ? (
          <p className="text-xs text-ink-3">{t("okrDrawer.noCheckIns")}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {detail.checkIns.map((checkIn) => (
              <li
                key={checkIn.id}
                className="flex flex-col gap-1 rounded-lg border border-line p-2.5"
              >
                <span className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span className="font-semibold text-ink-2">
                    {checkIn.author}
                  </span>
                  <span>{checkIn.on}</span>
                  {checkIn.status ? (
                    <Chip tone={STATUS[checkIn.status].tone}>
                      {t(STATUS[checkIn.status].label)}
                    </Chip>
                  ) : null}
                  {checkIn.confidence === null ? null : (
                    <span>
                      {t("okrList.confidence", {
                        value: String(Math.round(checkIn.confidence * 10)),
                      })}
                    </span>
                  )}
                </span>
                {checkIn.narrative ? (
                  <p className="text-xs text-ink-2">{checkIn.narrative}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {goal.keyResults.map((keyResult) => {
        const history = detail.keyResults[keyResult.id];
        return (
          <section
            key={keyResult.id}
            className="flex flex-col gap-1.5"
            aria-label={t("okrDrawer.historyOf", { title: keyResult.title })}
          >
            <h3 className="text-xs font-semibold text-ink">
              {keyResult.title}
            </h3>
            {!history ||
            (history.values.length === 0 && history.targets.length === 0) ? (
              <p className="text-xs text-ink-3">{t("okrDrawer.noHistory")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-xs text-ink-2">
                {history.targets.map((change) => (
                  <li
                    key={`target-${change.changedAt}`}
                    data-testid="target-change"
                    className="flex flex-col"
                  >
                    <span>
                      {t(
                        change.eased
                          ? "okrDrawer.targetEased"
                          : "okrDrawer.targetChanged",
                        {
                          from: formatMeasure(change.from, keyResult.unit),
                          to: formatMeasure(change.to, keyResult.unit),
                          name: change.changedBy ?? t("okrTree.somebody"),
                          date: change.changedAt.slice(0, 10),
                        },
                      )}
                    </span>
                    {change.reason ? (
                      <span className="text-ink-3">{change.reason}</span>
                    ) : null}
                  </li>
                ))}
                {history.values.map((entry) => (
                  <li
                    key={entry.id}
                    data-testid="value-entry"
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-ink-3">{entry.at.slice(0, 10)}</span>
                    <span className="font-semibold tabular-nums">
                      {formatMeasure(entry.value, keyResult.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

function Alignment({
  goal,
  tree,
  detail,
  canEdit,
  onOpen,
}: {
  readonly goal: OkrGoal;
  readonly tree: OkrTree;
  readonly detail: OkrDetail;
  readonly canEdit: boolean;
  readonly onOpen: (goalId: string) => void;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [removing, startRemoving] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  // Taking a dependency apart (completeness review M-35), here since the
  // studio's details panel became this tab (P9-T09b). Either end may.
  const remove = (dependencyId: string) => {
    setProblem(null);
    startRemoving(async () => {
      const result = await unlinkGoals(dependencyId);
      if (result.error) {
        setProblem(result.error);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: OKR_DETAIL_ALL });
      await queryClient.invalidateQueries({
        queryKey: okrCycleKey(tree.cycle.id),
      });
      router.refresh();
    });
  };
  const inTree = (id: string) => tree.goals.some((entry) => entry.id === id);
  // The key result this objective aligns to, named where the tree holds it.
  const parentKeyResult = goal.parentKeyResultId
    ? [
        ...tree.goals.flatMap((entry) => entry.keyResults),
        ...tree.context.flatMap((entry) => entry.keyResults),
      ].find((keyResult) => keyResult.id === goal.parentKeyResultId)
    : undefined;

  const opener = (id: string, title: string) =>
    inTree(id) ? (
      <button
        type="button"
        onClick={() => onOpen(id)}
        className="text-left text-xs font-semibold text-brand-text hover:underline"
      >
        {title}
      </button>
    ) : (
      <a
        href={`/goals/${id}`}
        className="text-xs font-semibold text-brand-text hover:underline"
      >
        {title}
      </a>
    );

  return (
    <>
      <section className="flex flex-col gap-1">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
          {t("okrDrawer.alignedTo")}
        </h3>
        {detail.relations.parent ? (
          <>
            {opener(detail.relations.parent.id, detail.relations.parent.title)}
            {parentKeyResult ? (
              <span className="text-xs text-ink-3">
                {t("okrDrawer.throughKeyResult", {
                  title: parentKeyResult.title,
                })}
              </span>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-ink-3">{t("okrDrawer.noParent")}</p>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
          {t("okrDrawer.alignedBelow")}
        </h3>
        {detail.relations.children.length === 0 ? (
          <p className="text-xs text-ink-3">{t("okrDrawer.noChildren")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.relations.children.map((child) => (
              <li key={child.id} className="flex items-center gap-2">
                {opener(child.id, child.title)}
                <span className="text-xs tabular-nums text-ink-3">
                  {Math.round(child.progressPct)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
          {t("okrDrawer.dependencies")}
        </h3>
        {detail.relations.dependencies.length === 0 ? (
          <p className="text-xs text-ink-3">{t("okrDrawer.noDependencies")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.relations.dependencies.map((dependency) => (
              <li key={dependency.id} className="flex items-start gap-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  {opener(dependency.goalId, dependency.title)}
                  {dependency.note ? (
                    <span className="text-xs text-ink-3">
                      {dependency.note}
                    </span>
                  ) : null}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    disabled={removing}
                    onClick={() => remove(dependency.id)}
                    aria-label={t("goals.studio.studio.removeDependencyOn", {
                      title: dependency.title,
                    })}
                    className="flex-none rounded-control px-2 py-0.5 text-xs text-ink-3 hover:bg-bad-bg hover:text-bad disabled:text-ink-4"
                  >
                    {t("goals.studio.studio.removeDependency")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {problem ? (
          <p role="alert" className="text-xs text-bad">
            {problem}
          </p>
        ) : null}
      </section>
    </>
  );
}
