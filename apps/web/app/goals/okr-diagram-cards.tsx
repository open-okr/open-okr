"use client";

import { okrKindsInUse } from "@openokr/method";
import { Bar, useTranslations } from "@openokr/ui";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { OkrGoal, OkrTree } from "../../lib/okr-tree/cache.ts";
import { HealthChip } from "./health-chip.tsx";
import {
  AddedMidCycle,
  DoneToggle,
  InlineNumber,
  InlineText,
  KindControl,
} from "./okr-cells.tsx";
import {
  type Coach,
  type OkrWrite,
  useKeyResultCells,
  useObjectiveCells,
} from "./okr-editing.ts";
import { keyResultHandle, type moveTargets } from "./okr-layout.ts";

/**
 * The diagram's cards (P9-T09a, edited in place since P9-T10a,
 * docs/design/p9-t00-okr-writing.md §5.3).
 *
 * **The list's own cells and writes**, in a card's shape: a title edited
 * where it is read (double-click it, or Enter on the focused card), a value
 * and a target typed into the key result's row, an eased target asking why in
 * that same row, and drafts for a new key result or a new aligned objective
 * that write nothing before Enter. What each sends is `okr-editing.ts`, which
 * the list and the drawer share, so a card can do nothing a row cannot.
 *
 * What every card needs is in `DiagramContext` rather than in each node's
 * data, which React Flow copies whenever a node changes.
 */

export interface DiagramShared {
  readonly okr: OkrWrite;
  readonly coach: Coach;
  readonly canEdit: boolean;
  readonly progressMax: number;
  /** The first card pressed in link mode, or null. */
  readonly linkFrom: string | null;
  /** The card whose title is being edited, or null. */
  readonly editingTitle: string | null;
  readonly setEditingTitle: (goalId: string | null) => void;
  readonly onToggle: (goalId: string) => void;
  readonly openKeyResultDraft: (goalId: string) => void;
  readonly closeKeyResultDraft: (goalId: string) => void;
  readonly openChildDraft: (goalId: string) => void;
  readonly closeChildDraft: () => void;
  /** Each resolves to the server's refusal, or null once it is saved. */
  readonly addKeyResult: (
    goal: OkrGoal,
    title: string,
  ) => Promise<string | null>;
  readonly addAligned: (
    parent: OkrGoal,
    title: string,
  ) => Promise<string | null>;
  /** The objectives on screen, for a draft to name its parent. */
  readonly goalById: (id: string) => OkrGoal | undefined;
  /** The card whose "Move under…" choice is open, or null (P9-T10b). */
  readonly moving: string | null;
  readonly setMoving: (goalId: string | null) => void;
  /** Where a card may move under, as `moveTargets` lists them. */
  readonly targetsFor: (goalId: string) => ReturnType<typeof moveTargets>;
  /** "cycle", `goal:<id>` or `kr:<id>`, from either way of moving. */
  readonly moveTo: (goalId: string, target: string) => void;
}

export const DiagramContext = createContext<DiagramShared | null>(null);

function useDiagram(): DiagramShared {
  const shared = useContext(DiagramContext);
  if (!shared) {
    throw new Error("A diagram card is drawn outside its diagram.");
  }
  return shared;
}

export type ObjectiveData = {
  readonly goal: OkrGoal;
  readonly collapsed: boolean;
  readonly hiddenBelow: number;
  readonly hasBelow: boolean;
  readonly drafting: boolean;
};
type ContextData = { readonly context: OkrTree["context"][number] };
type CycleData = { readonly name: string };
type DraftData = { readonly parentId: string };

const HIDDEN_HANDLE = "!h-1 !w-1 !min-w-0 !border-0 !bg-transparent";

/** A field that takes the keyboard the moment it appears. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  return ref;
}

function ObjectiveCard({ data }: NodeProps<Node<ObjectiveData, "objective">>) {
  const { t } = useTranslations();
  const shared = useDiagram();
  const { goal, collapsed, hiddenBelow, hasBelow, drafting } = data;
  const cells = useObjectiveCells(goal, shared.okr, shared.coach);
  const editing = shared.canEdit && shared.editingTitle === goal.id;
  const linkFrom = shared.linkFrom === goal.id;

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-surface text-left shadow-sm ${linkFrom ? "border-brand ring-2 ring-brand" : "border-line"}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      {/* The way to move a card by pointer: dragged onto another card, a key
       * result's row, the annual band or the cycle. "Move under…" below is
       * the keyboard's way to the same move (P9-T10b). */}
      {shared.canEdit ? (
        <Handle
          type="source"
          position={Position.Top}
          id="move"
          isConnectable
          title={t("okrDiagram.dragToMove")}
          className="!left-2.5 !top-2.5 !h-3.5 !w-3.5 !translate-x-0 !translate-y-0 !rounded-sm !border !border-line-2 !bg-raised hover:!border-brand hover:!bg-brand-weak"
        />
      ) : null}
      <div className="flex flex-col gap-1 px-3 pt-2">
        <span
          className={`flex items-center gap-1.5 pr-10 text-[10px] font-bold uppercase tracking-wider text-ink-3 ${shared.canEdit ? "pl-4" : ""}`}
        >
          {goal.level}
          <span className="truncate font-normal normal-case tracking-normal">
            {goal.champion.name}
          </span>
          <KindControl
            kind={goal.kind}
            title={goal.title}
            kinds={okrKindsInUse(shared.coach.practice)}
            readOnly={!shared.canEdit || goal.closedAt !== null}
            floating
            onSave={cells.saveKind}
          />
          <AddedMidCycle at={goal.addedMidCycleAt} />
        </span>
        {editing ? (
          <TitleEditor
            value={goal.title}
            onDraft={cells.onDraft}
            onSave={cells.saveTitle}
            onDone={() => shared.setEditingTitle(null)}
          />
        ) : (
          <span className="flex items-start gap-1">
            <span className="line-clamp-2 min-w-0 flex-1 text-xs font-bold leading-snug text-ink">
              {goal.title}
            </span>
            {/* A button rather than a double-click: a double-click on a card
             * is two presses, and each opens the drawer. Enter on the focused
             * card does the same (§5.4). */}
            {shared.canEdit ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  shared.setEditingTitle(goal.id);
                }}
                aria-label={t("okrDiagram.editTitleOf", { title: goal.title })}
                className="nodrag flex size-4 flex-none items-center justify-center rounded-control text-ink-4 hover:bg-raised hover:text-ink-2"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  className="size-3"
                >
                  <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
                </svg>
              </button>
            ) : null}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Bar
            value={goal.progressPct}
            max={shared.progressMax}
            label={goal.title}
            className="flex-1"
          />
          <span className="text-[11px] font-semibold tabular-nums text-ink-3">
            {Math.round(goal.progressPct)}%
          </span>
          <HealthChip health={goal.health} />
        </span>
      </div>
      {collapsed ? null : (
        <ul className="mt-1.5 flex flex-col border-t border-line">
          {goal.keyResults.map((keyResult) => (
            <KeyResultRow key={keyResult.id} keyResult={keyResult} />
          ))}
          {drafting ? <KeyResultDraft goal={goal} /> : null}
        </ul>
      )}
      {/* On an open card only: adding to a folded one would open it anyway,
       * and leaving them off the folded cards is what keeps three hundred
       * objectives inside their budget on arrival (design §7). */}
      {shared.canEdit && !collapsed && shared.moving === goal.id ? (
        <MoveUnder goal={goal} />
      ) : shared.canEdit && goal.closedAt === null && !collapsed ? (
        <span className="mt-auto flex items-center gap-1 border-t border-line px-2 py-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              shared.openKeyResultDraft(goal.id);
            }}
            aria-label={t("okrDiagram.addKeyResultTo", { title: goal.title })}
            className="nodrag rounded-control px-1.5 py-0.5 text-[11px] font-semibold text-brand-text hover:bg-brand-weak"
          >
            {t("okrDiagram.addKeyResult")}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              shared.openChildDraft(goal.id);
            }}
            aria-label={t("okrDiagram.addAlignedTo", { title: goal.title })}
            className="nodrag rounded-control px-1.5 py-0.5 text-[11px] font-semibold text-brand-text hover:bg-brand-weak"
          >
            {t("okrDiagram.addAligned")}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              shared.setMoving(goal.id);
            }}
            aria-label={t("okrDiagram.moveUnderOf", { title: goal.title })}
            className="nodrag ml-auto rounded-control px-1.5 py-0.5 text-[11px] font-semibold text-ink-3 hover:bg-raised hover:text-ink"
          >
            {t("okrDiagram.moveUnder")}
          </button>
        </span>
      ) : null}
      {hasBelow || goal.keyResults.length > 0 ? (
        <button
          type="button"
          // A press inside a card must not also count as opening it.
          onClick={(event) => {
            event.stopPropagation();
            shared.onToggle(goal.id);
          }}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t("okrDiagram.expand", { title: goal.title })
              : t("okrDiagram.collapse", { title: goal.title })
          }
          className="nodrag absolute right-1.5 top-1.5 rounded-control px-1 text-[10px] font-semibold text-ink-3 hover:bg-raised hover:text-ink"
        >
          {collapsed
            ? hiddenBelow > 0
              ? t("okrDiagram.moreBelow", { count: String(hiddenBelow) })
              : "+"
            : "−"}
        </button>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </div>
  );
}

/**
 * The title in edit: the list's own cell, given the keyboard on arrival, and
 * handed back to the card when it is left, whether it saved or not.
 */
function TitleEditor({
  value,
  onDraft,
  onSave,
  onDone,
}: {
  readonly value: string;
  readonly onDraft: (draft: string | null) => void;
  readonly onSave: (title: string) => void;
  readonly onDone: () => void;
}) {
  const { t } = useTranslations();
  const box = useFocusOnMount<HTMLSpanElement>();
  // Leaving the field ends the edit, and the keyboard goes back to the card.
  // A listener rather than a prop, because the span is not a control.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const element = box.current;
    const leave = () => {
      const card = element?.closest<HTMLElement>("[data-node-id]");
      done.current();
      requestAnimationFrame(() => card?.focus());
    };
    element?.addEventListener("focusout", leave);
    return () => element?.removeEventListener("focusout", leave);
  }, [box]);
  return (
    <span ref={box} className="nodrag">
      <InlineText
        value={value}
        label={t("goals.editor.objectiveTitle")}
        readOnly={false}
        bold
        onDraft={onDraft}
        onSave={onSave}
      />
    </span>
  );
}

function KeyResultRow({
  keyResult,
}: {
  readonly keyResult: OkrGoal["keyResults"][number];
}) {
  const { t } = useTranslations();
  const shared = useDiagram();
  const cells = useKeyResultCells(keyResult, shared.okr, shared.coach);
  const fromKpi = keyResult.kpiId !== null;
  const title = keyResult.title;

  return (
    <li
      data-kr-id={keyResult.id}
      className="relative flex h-[30px] items-center gap-1.5 border-b border-line px-3 text-[11px] text-ink-2 last:border-b-0"
    >
      {cells.easing !== null ? (
        <EasingReason
          from={keyResult.targetValue}
          to={cells.easing}
          onSave={cells.saveReason}
          onCancel={cells.cancelReason}
        />
      ) : (
        <>
          <span aria-hidden="true" className="text-ink-4">
            {keyResult.doneAt !== null ? "●" : "○"}
          </span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {/* §2.10: what the row asks for is its kind's question. */}
          {keyResult.kind === "milestone" ? (
            <span className="nodrag">
              <DoneToggle
                done={keyResult.doneAt !== null}
                title={title}
                readOnly={!shared.canEdit}
                onSave={cells.saveDone}
              />
            </span>
          ) : keyResult.kind === "baseline" ? (
            <span className="nodrag flex items-center gap-0.5 text-[11px]">
              <InlineNumber
                value={
                  keyResult.doneAt === null ? null : keyResult.currentValue
                }
                label={t("keyResultKind.baselineFor", { title })}
                readOnly={!shared.canEdit || fromKpi}
                onSave={cells.saveValue}
              />
            </span>
          ) : (
            <span className="nodrag flex items-center gap-0.5 text-[11px]">
              <InlineNumber
                value={keyResult.currentValue}
                label={t("goals.editor.valueFor", { title })}
                readOnly={!shared.canEdit || fromKpi}
                onSave={cells.saveValue}
              />
              <span className="text-ink-4">/</span>
              <InlineNumber
                key={cells.targetCell}
                value={keyResult.targetValue}
                label={t("okrList.targetOf", { title })}
                readOnly={!shared.canEdit}
                onSave={cells.saveTarget}
              />
            </span>
          )}
        </>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id={keyResultHandle(keyResult.id)}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </li>
  );
}

/**
 * "Move under…", the keyboard's way to re-parent (§5.4): every place the
 * card may hang from, chosen and saved at once, with the same six-second
 * undo a drag gets. Escape leaves it where it was.
 */
function MoveUnder({ goal }: { readonly goal: OkrGoal }) {
  const { t } = useTranslations();
  const shared = useDiagram();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLSelectElement>("select")?.focus();
  }, []);
  const current = goal.parentKeyResultId
    ? `kr:${goal.parentKeyResultId}`
    : goal.parentGoalId
      ? `goal:${goal.parentGoalId}`
      : "cycle";
  return (
    <span
      ref={box}
      className="nodrag mt-auto flex items-center gap-1 border-t border-line px-2 py-1"
    >
      <select
        aria-label={t("okrDiagram.moveUnderOf", { title: goal.title })}
        defaultValue={current}
        onChange={(event) => {
          shared.moveTo(goal.id, event.target.value);
          shared.setMoving(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            shared.setMoving(null);
          }
        }}
        onBlur={() => shared.setMoving(null)}
        className="min-w-0 flex-1 rounded-control border border-line bg-surface px-1 py-0.5 text-[11px] text-ink"
      >
        {shared.targetsFor(goal.id).map((target) => (
          <option key={target.value} value={target.value}>
            {target.kind === "cycle"
              ? t("okrDiagram.underTheCycle", { cycle: target.title })
              : target.kind === "keyResult"
                ? t("okrDiagram.underKeyResult", {
                    title: target.title,
                    objective: target.of ?? "",
                  })
                : target.title}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Why an eased target eased, asked in the row itself (METHOD v2 §2.9). */
function EasingReason({
  from,
  to,
  onSave,
  onCancel,
}: {
  readonly from: number;
  readonly to: number;
  readonly onSave: (reason: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslations();
  const [reason, setReason] = useState("");
  const box = useFocusOnMount<HTMLSpanElement>();
  return (
    <span
      ref={box}
      data-testid="target-reason"
      className="nodrag flex min-w-0 flex-1 items-center gap-1 rounded-control bg-warn-bg px-1"
    >
      <input
        value={reason}
        aria-label={t("okrList.whyEase", {
          from: String(from),
          to: String(to),
        })}
        placeholder={t("okrList.whyEase", {
          from: String(from),
          to: String(to),
        })}
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && reason.trim() !== "") {
            onSave(reason.trim());
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-3"
      />
    </span>
  );
}

/** A new key result at the foot of the stack, held here until Enter. */
function KeyResultDraft({ goal }: { readonly goal: OkrGoal }) {
  const { t } = useTranslations();
  const shared = useDiagram();
  return (
    <li className="flex h-[30px] items-center px-2">
      <DraftField
        label={t("okrDiagram.newKeyResultFor", { title: goal.title })}
        placeholder={t("goals.editor.keyResultPlaceholder")}
        onAdd={(title) => shared.addKeyResult(goal, title)}
        onClose={() => shared.closeKeyResultDraft(goal.id)}
      />
    </li>
  );
}

/**
 * A title field for a draft: nothing is written until Enter, Escape leaves
 * nothing behind, and a refusal keeps what was typed beside the reason.
 */
function DraftField({
  label,
  placeholder,
  onAdd,
  onClose,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly onAdd: (title: string) => Promise<string | null>;
  readonly onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const box = useFocusOnMount<HTMLSpanElement>();
  const commit = async () => {
    const wanted = title.trim();
    if (wanted === "" || saving) {
      return;
    }
    setSaving(true);
    const refused = await onAdd(wanted);
    setSaving(false);
    if (refused) {
      setProblem(refused);
      return;
    }
    onClose();
  };
  return (
    <span ref={box} className="nodrag flex min-w-0 flex-1 flex-col">
      <input
        value={title}
        aria-label={label}
        placeholder={placeholder}
        disabled={saving}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
          if (event.key === "Escape") {
            onClose();
          }
        }}
        className="min-w-0 rounded-control border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-brand"
      />
      {problem ? (
        <span role="alert" className="truncate text-[10px] text-bad">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

/** A new objective aligned under another, drawn where it will stand. */
function DraftCard({ data }: NodeProps<Node<DraftData, "draft">>) {
  const { t } = useTranslations();
  const shared = useDiagram();
  const parent = shared.goalById(data.parentId);
  return (
    <div className="flex h-full w-full flex-col gap-1 rounded-lg border border-dashed border-brand-line bg-brand-weak px-3 py-2">
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-text">
        {t("okrDiagram.newAligned")}
      </span>
      {parent ? (
        <DraftField
          label={t("okrDiagram.newAlignedUnder", { title: parent.title })}
          placeholder={t("goals.editor.objectivePlaceholder")}
          onAdd={(title) => shared.addAligned(parent, title)}
          onClose={shared.closeChildDraft}
        />
      ) : null}
    </div>
  );
}

function ContextCard({ data }: NodeProps<Node<ContextData, "context">>) {
  const { t } = useTranslations();
  const { context } = data;
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-dashed border-line bg-raised text-left">
      <div className="flex flex-col gap-0.5 px-3 pt-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-4">
          {context.cycleName ?? t("okrDiagram.anotherCycle")}
        </span>
        {/* Read-only on the canvas: it opens in its own cycle, with the
         * drawer, because this cycle's cache does not hold it. */}
        <a
          href={`/goals?okr=${context.id}`}
          className="nodrag line-clamp-2 text-xs font-semibold text-ink-2 hover:underline"
        >
          {context.title}
        </a>
      </div>
      <ul className="mt-1 flex flex-col">
        {context.keyResults.map((keyResult) => (
          <li
            key={keyResult.id}
            data-kr-id={keyResult.id}
            className="relative flex h-[22px] items-center px-3 text-[10px] text-ink-3"
          >
            <span className="truncate">{keyResult.title}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={keyResultHandle(keyResult.id)}
              isConnectable={false}
              className={HIDDEN_HANDLE}
            />
          </li>
        ))}
      </ul>
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </div>
  );
}

function CycleCard({ data }: NodeProps<Node<CycleData, "cycle">>) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-brand-line bg-brand-weak px-3 text-sm font-bold text-brand-text">
      {data.name}
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </div>
  );
}

export const NODE_TYPES = {
  objective: ObjectiveCard,
  context: ContextCard,
  cycle: CycleCard,
  draft: DraftCard,
};
