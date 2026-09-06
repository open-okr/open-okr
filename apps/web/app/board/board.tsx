"use client";

import { Chip } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { WriteState } from "../cycle/write-state.ts";

/**
 * The four-column board with drag, optimistic updates and live refresh
 * (UIUX-PLAN.md §6 S-27, P5-T11).
 *
 * **The browser never computes a position.** A drag sends the card it landed
 * after and the column it landed in; the server takes the lock and decides the
 * rest. A client that computed its own position would be a second opinion about
 * an order that has exactly one, and two browsers would disagree the moment two
 * people dragged at the same time.
 *
 * **Optimistic, then corrected.** The card moves under the pointer immediately
 * and the write follows. A refusal puts the board back the way it was and says
 * why, because a card that silently sprang back would leave somebody guessing
 * whether they missed the drop or lack access.
 *
 * **Live is a nudge to re-read, never data.** The stream carries identifiers,
 * and receiving one calls `router.refresh()`. Row-level security and `can()`
 * stay in the loop, which is the realtime port's own contract.
 *
 * Native HTML drag and drop rather than a library: no new runtime dependency
 * (CLAUDE.md), and the keyboard path below is what actually makes the board
 * usable without a pointer.
 */

interface BoardCard {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly dueOn: string | null;
  readonly keyResultTitle: string | null;
  readonly assignees: readonly { readonly id: string; readonly name: string }[];
  readonly checklist: { readonly done: number; readonly total: number };
}

export interface BoardColumn {
  readonly status: string;
  readonly cards: readonly BoardCard[];
}

const COLUMN_LABEL: Readonly<Record<string, string>> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/** Where a card can go from where it is, for the keyboard path. */
const ORDER = ["backlog", "todo", "in_progress", "done"] as const;

export function Board({
  spaceId,
  columns,
  canEdit,
  onMove,
}: {
  readonly spaceId: string;
  readonly columns: readonly BoardColumn[];
  readonly canEdit: boolean;
  readonly onMove: (
    id: string,
    status: string,
    afterTaskId: string | null,
  ) => Promise<WriteState>;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<readonly BoardColumn[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // **The server's answer wins the moment it arrives**, or the board would keep
  // showing the optimistic order after a refresh corrected it. Adjusted during
  // render rather than in an effect, which is React's own answer to "reset state
  // when a prop changes": an effect would paint the stale order once first.
  const [seen, setSeen] = useState(columns);
  if (seen !== columns) {
    setSeen(columns);
    setOptimistic(null);
  }

  useEffect(() => {
    const source = new EventSource(`/api/board/${spaceId}/live`);
    const onChange = () => {
      router.refresh();
    };
    source.addEventListener("board.changed", onChange);
    return () => {
      source.removeEventListener("board.changed", onChange);
      source.close();
    };
  }, [spaceId, router]);

  const shown = optimistic ?? columns;

  const move = (id: string, status: string, afterTaskId: string | null) => {
    const before = shown;
    setOptimistic(reorder(shown, id, status, afterTaskId));
    setError(null);
    startTransition(async () => {
      const state = await onMove(id, status, afterTaskId);
      if (state.error) {
        setOptimistic(before);
        setError(state.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {shown.map((column) => (
          <section
            key={column.status}
            aria-label={COLUMN_LABEL[column.status] ?? column.status}
            className="flex min-h-24 flex-col gap-2 rounded-lg border border-line bg-raised p-2"
            onDragOver={(event) => {
              if (canEdit && dragging) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (canEdit && dragging) {
                const last = column.cards[column.cards.length - 1];
                move(
                  dragging,
                  column.status,
                  last && last.id !== dragging ? last.id : null,
                );
                setDragging(null);
              }
            }}
          >
            <header className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold text-ink-2">
                {COLUMN_LABEL[column.status] ?? column.status}
              </h2>
              <span className="text-xs text-ink-3">{column.cards.length}</span>
            </header>

            <ul className="flex flex-col gap-2">
              {column.cards.map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  canEdit={canEdit}
                  onDragStart={() => setDragging(card.id)}
                  onDragEnd={() => setDragging(null)}
                  onDropAfter={() => {
                    if (canEdit && dragging && dragging !== card.id) {
                      move(dragging, column.status, card.id);
                      setDragging(null);
                    }
                  }}
                  onShift={(direction) => {
                    const index = ORDER.indexOf(
                      column.status as (typeof ORDER)[number],
                    );
                    const next = ORDER[index + direction];
                    if (next) {
                      move(card.id, next, null);
                    }
                  }}
                />
              ))}
              {column.cards.length === 0 ? (
                <li className="rounded-md border border-line border-dashed px-2 py-4 text-center text-xs text-ink-3">
                  Nothing here.
                </li>
              ) : null}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Card({
  card,
  canEdit,
  onDragStart,
  onDragEnd,
  onDropAfter,
  onShift,
}: {
  readonly card: BoardCard;
  readonly canEdit: boolean;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDropAfter: () => void;
  readonly onShift: (direction: 1 | -1) => void;
}) {
  return (
    <li
      data-testid="board-card"
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (canEdit) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropAfter();
      }}
      className="flex flex-col gap-1 rounded-md border border-line bg-surface px-2 py-1.5"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/tasks/${card.id}`}
          className="text-sm text-ink hover:text-brand-text"
        >
          {card.title}
        </Link>
        {canEdit ? (
          // The keyboard path §9 asks for. Drag is the fast way and this is the
          // way that works without a pointer.
          <span className="flex flex-none gap-1">
            <button
              type="button"
              aria-label={`Move ${card.title} back a column`}
              onClick={() => onShift(-1)}
              className="rounded border border-line px-1 text-xs text-ink-3 hover:border-brand"
            >
              ←
            </button>
            <button
              type="button"
              aria-label={`Move ${card.title} on a column`}
              onClick={() => onShift(1)}
              className="rounded border border-line px-1 text-xs text-ink-3 hover:border-brand"
            >
              →
            </button>
          </span>
        ) : null}
      </div>

      {card.keyResultTitle ? (
        <p className="truncate text-xs text-ink-3">{card.keyResultTitle}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {card.dueOn ? <Chip tone="neutral">{card.dueOn}</Chip> : null}
        {card.checklist.total > 0 ? (
          <Chip tone="neutral">
            {card.checklist.done}/{card.checklist.total}
          </Chip>
        ) : null}
        {card.assignees.map((one) => (
          <Chip key={one.id} tone="brand">
            {one.name}
          </Chip>
        ))}
      </div>
    </li>
  );
}

/**
 * The board as it will look once the server agrees, computed locally.
 *
 * Position is not guessed: the card is spliced into the array at the slot it was
 * dropped into, and the server's own order replaces this the moment the refresh
 * lands. This exists so the card does not sit still under the pointer.
 */
function reorder(
  columns: readonly BoardColumn[],
  id: string,
  status: string,
  afterTaskId: string | null,
): BoardColumn[] {
  const moving = columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === id);
  if (!moving) {
    return [...columns];
  }
  return columns.map((column) => {
    const without = column.cards.filter((card) => card.id !== id);
    if (column.status !== status) {
      return { ...column, cards: without };
    }
    const at = afterTaskId
      ? without.findIndex((card) => card.id === afterTaskId) + 1
      : 0;
    const cards = [...without];
    cards.splice(at, 0, { ...moving, status });
    return { ...column, cards };
  });
}
