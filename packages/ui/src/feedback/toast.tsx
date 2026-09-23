"use client";

/**
 * Transient messages that find the reader, rather than waiting to be found
 * (P8-G11a).
 *
 * **UIUX-PLAN.md has specified toasts since the interface was designed and
 * none existed.** §1's seventh principle gives reversible destruction an undo
 * toast rather than a confirmation, §4 rolls an optimistic update back "with a
 * toast", §4 again sets the undo window at six seconds, and §7 lists toasts
 * first among the surfaces needing a live region. Nothing in `packages/ui`
 * implemented any of it, so every screen that had something to say printed it
 * where it stood and hoped somebody was looking.
 *
 * **What made that a defect rather than a shortcoming.** On `/admin/rhythm` a
 * refusal rendered at the top of the card, and the card is up to 1,700px tall
 * with its Save in a header that stays on screen. So you could press Save at
 * the bottom of twenty parameters, have the method refuse the value, and see
 * nothing at all: the sentence was above the fold, in a card you were already
 * inside. Agung reported exactly that.
 *
 * **Two live regions, not one.** A confirmation is `polite` and waits for a
 * gap in whatever the screen reader is saying. A refusal is `assertive` and
 * interrupts, because it is about something the reader just did that did not
 * happen. Both are in the document from first paint rather than mounted with
 * the message, because a live region added at the same moment as its content
 * is not reliably announced.
 *
 * **They carry `aria-live` and no `role`**, which is not a style preference.
 * `role="status"` and `role="alert"` only restate the `aria-live` already
 * there, and because these two regions are in every page from first paint they
 * put two permanently empty matches into every `getByRole("status")` and
 * `getByRole("alert")` on the site. Four existing specs went red that way the
 * first time this shipped, on screens that have nothing to do with toasts.
 *
 * **Everything clears itself, a refusal more slowly than a confirmation.**
 * §4's six seconds is the undo window and the confirmation default. A refusal
 * gets fifteen, because it carries a threshold key and a bound and is simply
 * more to read. Agung asked for both to close on their own on 23 September
 * 2026; the argument for holding a refusal until dismissed was that it was the
 * only record of the problem, and it no longer is, because the caller also
 * marks the field and prints the sentence under it. A toast is the thing that
 * fetches your attention, not the thing that keeps the receipt.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn.ts";

export type ToastTone = "ok" | "bad";

export interface ToastRequest {
  readonly tone: ToastTone;
  /** One line, in the reader's own terms. Optional: many toasts are one line. */
  readonly title?: string;
  readonly message: string;
  /**
   * Milliseconds before it removes itself, or 0 to stay until dismissed.
   * Defaults to §4's six seconds for a confirmation and fifteen for a refusal,
   * which carries a key and a bound and is more to read.
   */
  readonly duration?: number;
  /**
   * What raised it. A new toast with the same source replaces the one there.
   *
   * **Without this a refusal outlives the thing it was about.** It runs for
   * fifteen seconds, and reading it, fixing the value and pressing Save again
   * takes rather less than that, so the old refusal would still be sitting
   * beside the new confirmation with nothing to say which is current. One
   * card, one toast.
   */
  readonly source?: string;
}

interface Toast extends ToastRequest {
  readonly id: number;
}

interface ToastValue {
  show(request: ToastRequest): void;
}

const ToastContext = createContext<ToastValue | null>(null);

/** §4's undo window, and the confirmation default with it. */
const CONFIRMATION_MS = 6_000;

/**
 * Longer, because a refusal is a threshold key, a bound and a sentence rather
 * than one word, and because the reader has to look away from it to find the
 * field it is about.
 */
const REFUSAL_MS = 15_000;

export function ToastProvider({
  dismissLabel = "Dismiss",
  children,
}: {
  /**
   * A parameter rather than a constant: this package holds no catalogue of
   * its own and the shell passes the translated word in.
   */
  readonly dismissLabel?: string;
  readonly children: ReactNode;
}) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(0);
  // Cleared on unmount, so a page left while a toast is counting down does not
  // call `setToasts` on a component that is gone.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((request: ToastRequest) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => {
      const replaced =
        request.source === undefined
          ? current
          : current.filter((toast) => {
              if (toast.source !== request.source) {
                return true;
              }
              const timer = timers.current.get(toast.id);
              if (timer) {
                clearTimeout(timer);
                timers.current.delete(toast.id);
              }
              return false;
            });
      return [...replaced, { ...request, id }];
    });

    const duration =
      request.duration ??
      (request.tone === "bad" ? REFUSAL_MS : CONFIRMATION_MS);
    if (duration > 0) {
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setToasts((current) => current.filter((toast) => toast.id !== id));
        }, duration),
      );
    }
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
       * `bottom-16` below the breakpoint clears the 56px mobile tab bar, which
       * is fixed to the bottom of the same viewport. `z-50` puts it over the
       * copilot panel at 40; the command palette is also 50 and is a modal
       * over the whole page, so a toast underneath it is the right way round.
       */}
      <div className="pointer-events-none fixed right-4 bottom-16 left-4 z-50 flex flex-col items-end gap-2 md:bottom-4 md:left-auto md:w-96">
        {/*
         * Both regions exist from first paint and stay. A live region created
         * in the same commit as its text is not reliably announced, which is
         * the single most common way a toast ends up silent.
         */}
        <ToastRegion
          toasts={toasts.filter((toast) => toast.tone === "ok")}
          politeness="polite"
          name="status"
          dismissLabel={dismissLabel}
          onDismiss={dismiss}
        />
        <ToastRegion
          toasts={toasts.filter((toast) => toast.tone === "bad")}
          politeness="assertive"
          name="alert"
          dismissLabel={dismissLabel}
          onDismiss={dismiss}
        />
      </div>
    </ToastContext.Provider>
  );
}

function ToastRegion({
  toasts,
  politeness,
  name,
  dismissLabel,
  onDismiss,
}: {
  readonly toasts: readonly Toast[];
  readonly politeness: "polite" | "assertive";
  /** Only for the test id. Deliberately not a `role`, see the note above. */
  readonly name: "status" | "alert";
  readonly dismissLabel: string;
  readonly onDismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live={politeness}
      // Any change announces the whole toast rather than the words that
      // differ, so "Saved. 2 thresholds differ" is not read as "2".
      aria-atomic="false"
      className="flex w-full flex-col items-stretch gap-2"
      data-testid={`toast-region-${name}`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          data-tone={toast.tone}
          className={cn(
            "pointer-events-auto flex items-start gap-2.5 rounded-lg border p-3 shadow-popover",
            toast.tone === "bad"
              ? "border-bad-dot bg-bad-bg"
              : "border-line bg-surface",
          )}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            {toast.title ? (
              <p
                className={cn(
                  "text-sm font-semibold",
                  toast.tone === "bad" ? "text-bad" : "text-ink",
                )}
              >
                {toast.title}
              </p>
            ) : null}
            {/* `wrap-break-word` because a refusal can name a threshold key
                with no spaces in it, and without this the toast sets its own
                width from that one word. */}
            <p
              className={cn(
                "wrap-break-word text-sm",
                toast.tone === "bad" ? "text-bad" : "text-ink-2",
              )}
            >
              {toast.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label={dismissLabel}
            className="ml-auto rounded-md px-1.5 py-0.5 text-sm text-ink-3 hover:text-ink focus:outline-2 focus:outline-brand"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Silent without a provider, deliberately, for the reason `useUnsavedGuard`
 * gives: a component rendered in a test or in the gallery still works, it just
 * does not raise toasts. Throwing would make the provider a requirement of
 * rendering a form.
 */
export function useToast(): ToastValue {
  const context = useContext(ToastContext);
  const noop = useMemo<ToastValue>(() => ({ show: () => undefined }), []);
  return context ?? noop;
}
