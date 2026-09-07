"use client";

import { Kbd } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { type PaletteAnswer, paletteSearchAction } from "./actions.ts";

/**
 * The command palette (UIUX-PLAN.md §4 S-32, P5-T13).
 *
 * **⌘K opens it, Escape closes it, the arrows move and Enter opens.** That is
 * the whole contract, and it is a keyboard surface first: a palette somebody
 * has to reach for a pointer to use is a slower version of the search page.
 *
 * **Every result is a link the server decided on.** The row carries an `href`
 * from `search.query`, which is the same access-filtered read the search page
 * asks. The palette never queries anything itself and cannot widen what it can
 * see.
 *
 * **The snippet is emphasised by Postgres and rendered as text.** `ts_headline`
 * marks matches with `<b>`, and this splits on those markers and renders the
 * pieces rather than setting HTML: the words in it are typed by people, and a
 * snippet is not a place to start trusting them.
 */
const EMPTY: PaletteAnswer = { jump: null, hits: [], error: null };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<PaletteAnswer>(EMPTY);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((was) => !was);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      input.current?.focus();
    } else {
      setText("");
      setAnswer(EMPTY);
      setActive(0);
    }
  }, [open]);

  const ask = useCallback((phrase: string) => {
    startTransition(async () => {
      setAnswer(await paletteSearchAction(phrase));
      setActive(0);
    });
  }, []);

  const rows = [
    ...(answer.jump
      ? [
          {
            key: "jump",
            title: answer.jump.title,
            snippet: `Jump to this ${answer.jump.entityType}`,
            href: answer.jump.href,
            semantic: false,
          },
        ]
      : []),
    ...answer.hits.map((hit) => ({
      key: `${hit.entityType}:${hit.entityId}`,
      title: hit.title,
      snippet: hit.snippet,
      href: hit.href,
      semantic: hit.semantic,
    })),
  ];

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-24">
      {/*
       * The backdrop is a button, because clicking it does something. A div
       * with a click handler is a control keyboard users cannot reach, and
       * Escape already closes this for them.
       */}
      <button
        type="button"
        aria-label="Close the search"
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-scrim"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        data-testid="palette"
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2 border-line border-b px-3 py-2">
          <input
            ref={input}
            value={text}
            aria-label="Search everything"
            placeholder="Search, or type a short identifier"
            className="flex-1 bg-transparent text-sm text-ink outline-none"
            onChange={(event) => {
              setText(event.target.value);
              ask(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((was) => Math.min(was + 1, rows.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((was) => Math.max(was - 1, 0));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const row = rows[active];
                if (row) {
                  setOpen(false);
                  router.push(row.href);
                }
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {answer.error ? (
            <p role="alert" className="px-3 py-4 text-sm text-bad">
              {answer.error}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-3">
              {text.trim() === ""
                ? "Type to search goals, key results, KPIs, initiatives, tasks, documents and more."
                : pending
                  ? "Looking…"
                  : "Nothing matches. Only what you can already open is here."}
            </p>
          ) : (
            <ul data-testid="palette-results">
              {rows.map((row, index) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(row.href);
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={
                      index === active
                        ? "flex w-full flex-col items-start gap-0.5 bg-brand-weak px-3 py-2 text-left"
                        : "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-raised"
                    }
                  >
                    <span className="text-sm font-semibold text-ink">
                      {row.title}
                    </span>
                    <span className="line-clamp-2 text-xs text-ink-3">
                      <Snippet text={row.snippet} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * `ts_headline`'s emphasis, rendered as elements rather than as HTML.
 *
 * Postgres marks the matching words with `<b>` and `</b>`. Setting that as HTML
 * would be trusting a string built from words a person typed, so the markers
 * are split on and the pieces are rendered.
 */
export function Snippet({ text }: { readonly text: string }) {
  const parts = text.split(/<b>|<\/b>/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one split have no identity beyond their position, and the string is re-split whole on every render
          <mark key={index} className="bg-warn-bg text-warn">
            {part}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
