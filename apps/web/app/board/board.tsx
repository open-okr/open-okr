"use client";

import { Chip, useTranslations } from "@openokr/ui";
import { GripVertical } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import type { WriteState } from "../cycle/write-state.ts";
import {
  afterTaskIdOf,
  isMoveKey,
  type MoveKey,
  placeAt,
  slotOf,
  stepTarget,
} from "./board-keys.ts";
import { BoardPresence, type PresentMember } from "./presence.tsx";

/**
 * The four-column board with drag, the keyboard, optimistic updates, live
 * refresh and presence (UIUX-PLAN.md §6 S-27, P5-T11, completeness review
 * M-02).
 *
 * **The browser never computes a position.** A drag or a keyboard drop sends
 * the card it landed after and the column it landed in; the server takes the
 * lock and decides the rest. A client that computed its own position would be
 * a second opinion about an order that has exactly one, and two browsers would
 * disagree the moment two people moved cards at the same time.
 *
 * **Optimistic, then corrected.** The card moves at once and the write follows.
 * A refusal puts the board back the way it was and says why, because a card
 * that silently sprang back would leave somebody guessing whether they missed
 * the drop or lack access.
 *
 * **The keyboard moves a card the way a sortable list does** (WAI-ARIA
 * practices, UIUX-PLAN §9). Each card has a move handle. Space or Enter picks
 * the card up, the arrow keys carry it up and down its column and across to the
 * next one, Space or Enter drops it and Escape puts it back. Every step is said
 * aloud in a live region: where the card is, and how many cards share its
 * column. Nothing is written until the drop, and the drop is one `tasks.move`,
 * the same concurrency-safe write a drag makes.
 *
 * **Live is a nudge to re-read, never data.** The stream carries a bare ping,
 * and receiving one calls `router.refresh()`. Row-level security and `can()`
 * stay in the loop, which is the realtime port's own contract. It carries the
 * names of whoever else has the board open too, already filtered on the server.
 *
 * Native HTML drag and drop rather than a library: no new runtime dependency
 * (CLAUDE.md), and the keyboard path is what makes the board usable without a
 * pointer.
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

/** What the board is of, which decides the stream it listens to. */
export interface BoardScopeRef {
  readonly kind: "space" | "initiative" | "key_result";
  readonly id: string;
}

/** The query parameter each scope is named by, here and on `/board`. */
const SCOPE_PARAMETER: Readonly<Record<BoardScopeRef["kind"], string>> = {
  space: "space",
  initiative: "initiative",
  key_result: "keyResult",
};

const COLUMN_LABEL_KEY: Readonly<Record<string, string>> = {
  backlog: "board.backlog",
  todo: "board.toDo",
  in_progress: "common.inProgress",
  done: "board.done",
};

/** Where a card can go from where it is, for the column buttons. */
const ORDER = ["backlog", "todo", "in_progress", "done"] as const;

/** A card picked up with the keyboard, and the board as it was before. */
interface Held {
  readonly id: string;
  readonly before: readonly BoardColumn[];
}

export function Board({
  scope,
  columns,
  canEdit,
  onMove,
}: {
  readonly scope: BoardScopeRef;
  readonly columns: readonly BoardColumn[];
  readonly canEdit: boolean;
  readonly onMove: (
    id: string,
    status: string,
    afterTaskId: string | null,
  ) => Promise<WriteState>;
}) {
  const { t } = useTranslations();

  const router = useRouter();
  const [optimistic, setOptimistic] = useState<readonly BoardColumn[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [present, setPresent] = useState<readonly PresentMember[]>([]);
  const [, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const instructionsId = useId();

  const columnLabel = (status: string) =>
    COLUMN_LABEL_KEY[status] ? t(COLUMN_LABEL_KEY[status]) : status;

  // **The server's answer wins the moment it arrives**, or the board would keep
  // showing the optimistic order after a refresh corrected it. Adjusted during
  // render rather than in an effect, which is React's own answer to "reset state
  // when a prop changes": an effect would paint the stale order once first.
  //
  // A card being carried is the exception. Somebody else's move must not snatch
  // it out of the reader's hands, so it is put back where they were holding it,
  // on the fresh board. A card deleted while held is let go, and said so.
  const [seen, setSeen] = useState(columns);
  if (seen !== columns) {
    setSeen(columns);
    const holding = held ? slotOf(optimistic ?? seen, held.id) : null;
    const kept =
      held && holding
        ? placeAt(columns, held.id, holding.status, holding.index)
        : null;
    if (held && kept) {
      setHeld({ id: held.id, before: columns });
      setOptimistic(kept);
    } else {
      if (held) {
        setHeld(null);
        setAnnouncement(t("board.board.cardGone"));
      }
      setOptimistic(null);
    }
  }

  const liveUrl = `/api/board/live?${SCOPE_PARAMETER[scope.kind]}=${scope.id}`;
  useEffect(() => {
    // No stream, no presence: a browser without `EventSource`, or a server
    // whose realtime is down, still gets a working board.
    if (typeof EventSource === "undefined") {
      return;
    }
    const source = new EventSource(liveUrl);
    const onChange = () => {
      router.refresh();
    };
    const onPresence = (event: MessageEvent<string>) => {
      try {
        const { members } = JSON.parse(event.data) as {
          members?: readonly PresentMember[];
        };
        setPresent(Array.isArray(members) ? members : []);
      } catch {
        setPresent([]);
      }
    };
    // A dropped stream shows nobody rather than whoever was there when it
    // dropped. A reconnect is answered with the list again.
    const onError = () => {
      setPresent([]);
    };
    source.addEventListener("board.changed", onChange);
    source.addEventListener("presence", onPresence);
    source.addEventListener("error", onError);
    return () => {
      source.removeEventListener("board.changed", onChange);
      source.removeEventListener("presence", onPresence);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [liveUrl, router]);

  // Focus follows a carried card. Moving it to another column mounts it in
  // another list, and a keyboard user whose focus fell back to the page would
  // have to find the card again after every step.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) {
      return;
    }
    refocus.current = null;
    root.current
      ?.querySelector<HTMLElement>(`[data-move-handle="${id}"]`)
      ?.focus();
  });

  const shown = optimistic ?? columns;

  const titleOf = (id: string) =>
    shown.flatMap((column) => column.cards).find((card) => card.id === id)
      ?.title ?? "";

  /** Where a card is, as a sentence: its column, its place and the column's size. */
  const whereIs = (board: readonly BoardColumn[], id: string) => {
    const slot = slotOf(board, id);
    return slot
      ? t("board.board.where", {
          column: columnLabel(slot.status),
          position: slot.index + 1,
          count: slot.count,
        })
      : "";
  };

  const move = (
    id: string,
    status: string,
    afterTaskId: string | null,
    before: readonly BoardColumn[] = shown,
  ) => {
    setOptimistic(reorder(shown, id, status, afterTaskId));
    setError(null);
    startTransition(async () => {
      const state = await onMove(id, status, afterTaskId);
      if (state.error) {
        setOptimistic(before === columns ? null : before);
        // Said by the alert below, once. The live region would say it twice.
        setError(state.error);
        return;
      }
      router.refresh();
    });
  };

  const pickUp = (id: string) => {
    setHeld({ id, before: shown });
    setOptimistic(shown);
    setError(null);
    refocus.current = id;
    setAnnouncement(
      t("board.board.pickedUp", {
        title: titleOf(id),
        where: whereIs(shown, id),
      }),
    );
  };

  const step = (key: MoveKey) => {
    if (!held) {
      return;
    }
    const target = stepTarget(shown, held.id, key);
    const next = target
      ? placeAt(shown, held.id, target.status, target.index)
      : null;
    if (!next) {
      // Already at the edge. Said, so a key that did nothing is not a key
      // that seemed broken.
      setAnnouncement(
        t("board.board.cannotGoFurther", { where: whereIs(shown, held.id) }),
      );
      return;
    }
    setOptimistic(next);
    refocus.current = held.id;
    setAnnouncement(
      t("board.board.movedTo", {
        title: titleOf(held.id),
        where: whereIs(next, held.id),
      }),
    );
  };

  const drop = () => {
    if (!held) {
      return;
    }
    const { id, before } = held;
    setHeld(null);
    refocus.current = id;
    const slot = slotOf(shown, id);
    const was = slotOf(before, id);
    const afterTaskId = afterTaskIdOf(shown, id);
    setAnnouncement(
      t("board.board.dropped", {
        title: titleOf(id),
        where: whereIs(shown, id),
      }),
    );
    if (
      !slot ||
      (was &&
        was.status === slot.status &&
        afterTaskIdOf(before, id) === afterTaskId)
    ) {
      // Put down where it was picked up. Nothing moved, so nothing is written.
      setOptimistic(before === columns ? null : before);
      return;
    }
    move(id, slot.status, afterTaskId, before);
  };

  /** `keepFocus` is false when the reader is tabbing away and focus should go with them. */
  const putBack = (keepFocus = true) => {
    if (!held) {
      return;
    }
    const { id, before } = held;
    setHeld(null);
    setOptimistic(before === columns ? null : before);
    if (keepFocus) {
      refocus.current = id;
    }
    setAnnouncement(
      t("board.board.putBack", {
        title: titleOf(id),
        where: whereIs(before, id),
      }),
    );
  };

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Space and Enter press the button, which is `onClick` below. Only a held
    // card listens for the rest, so the arrow keys keep their ordinary
    // meaning everywhere else on the page.
    if (!held) {
      return;
    }
    if (isMoveKey(event.key)) {
      event.preventDefault();
      step(event.key);
    } else if (event.key === "Escape") {
      event.preventDefault();
      putBack();
    } else if (event.key === "Tab") {
      // Leaving the card puts it back rather than leaving it hanging.
      putBack(false);
    }
  };

  // The handle presses: pick a card up, or drop the one it is carrying. A
  // pointer that presses another card's handle mid-carry puts the carried one
  // back, because a drop is always a deliberate act on the card being moved.
  const onHandle = (id: string) => {
    if (!held) {
      pickUp(id);
    } else if (held.id === id) {
      drop();
    } else {
      putBack();
    }
  };

  return (
    <div ref={root} className="flex flex-col gap-2">
      <div className="flex min-h-5 items-center justify-end">
        <BoardPresence members={present} />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {error}
        </p>
      ) : null}

      {canEdit ? (
        <>
          <p id={instructionsId} className="sr-only">
            {t("board.board.moveInstructions")}
          </p>
          <p
            className="sr-only"
            aria-live="assertive"
            aria-atomic="true"
            data-testid="board-announcer"
          >
            {announcement}
          </p>
        </>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {shown.map((column) => (
          <section
            key={column.status}
            aria-label={columnLabel(column.status)}
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
                {columnLabel(column.status)}
              </h2>
              <span className="text-xs text-ink-3">{column.cards.length}</span>
            </header>

            <ul className="flex flex-col gap-2">
              {column.cards.map((card) => (
                <Card
                  key={card.id}
                  card={card}
                  canEdit={canEdit}
                  held={held?.id === card.id}
                  instructionsId={instructionsId}
                  onDragStart={() => setDragging(card.id)}
                  onDragEnd={() => setDragging(null)}
                  onDropAfter={() => {
                    if (canEdit && dragging && dragging !== card.id) {
                      move(dragging, column.status, card.id);
                      setDragging(null);
                    }
                  }}
                  onHandle={() => onHandle(card.id)}
                  onHandleKey={onHandleKey}
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
                  {t("board.board.nothingHere")}
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
  held,
  instructionsId,
  onDragStart,
  onDragEnd,
  onDropAfter,
  onHandle,
  onHandleKey,
  onShift,
}: {
  readonly card: BoardCard;
  readonly canEdit: boolean;
  readonly held: boolean;
  readonly instructionsId: string;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDropAfter: () => void;
  readonly onHandle: () => void;
  readonly onHandleKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly onShift: (direction: 1 | -1) => void;
}) {
  const { t } = useTranslations();
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
      className={
        held
          ? "flex flex-col gap-1 rounded-md border border-brand bg-brand-weak px-2 py-1.5 shadow-sm"
          : "flex flex-col gap-1 rounded-md border border-line bg-surface px-2 py-1.5"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-1">
          {canEdit ? (
            <button
              type="button"
              data-move-handle={card.id}
              aria-label={t("board.board.reorder", { title: card.title })}
              aria-describedby={instructionsId}
              aria-pressed={held}
              onClick={onHandle}
              onKeyDown={onHandleKey}
              className="mt-0.5 flex-none cursor-grab rounded text-ink-4 hover:text-ink-2 aria-pressed:text-brand-text"
            >
              <GripVertical aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
          <Link
            href={`/tasks/${card.id}`}
            className="text-sm text-ink hover:text-brand-text"
          >
            {card.title}
          </Link>
        </span>
        {canEdit ? (
          // The pointer path §9 asks for beside the drag: a column at a time,
          // for a touch screen where native drag does not reach.
          <span className="flex flex-none gap-1">
            <button
              type="button"
              aria-label={t("board.board.moveBack", { title: card.title })}
              onClick={() => onShift(-1)}
              className="rounded border border-line px-1 text-xs text-ink-3 hover:border-brand"
            >
              ←
            </button>
            <button
              type="button"
              aria-label={t("board.board.moveOn", { title: card.title })}
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
