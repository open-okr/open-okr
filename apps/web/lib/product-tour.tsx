"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { finishTour } from "../app/tour-actions";

/**
 * The product tour on a first sign-in (UIUX-PLAN S-34, plan 0.8.0 T1).
 *
 * **Offered on whatever screen the first sign-in lands on.** It replaced a card
 * drawn only on the Work Map, which since the role homes most members never
 * opened. A welcome dialog offers Start tour or Skip tour; the tour then shows
 * one step at a time, with the step's area lit and everything else dimmed and
 * out of reach until it ends.
 *
 * **Skip ends it for good, and so does Escape.** Either way it is the same
 * write as finishing, `people.finishOwnTour`, on the member's own row. The
 * browser also remembers, under `ENDED_KEY`, so an ended tour is not offered
 * here again even if that write did not land. Take the tour again, in the
 * avatar menu, starts it once more with the `START_EVENT` event.
 *
 * **On a demo the browser alone remembers.** A persona is shared by every
 * visitor, so the first visitor's Skip written to the member would end the
 * tour for everybody after them.
 *
 * **Steps whose area is not on screen are left out**: the cycle strip outside
 * planning, the search box on a phone, Ask AI with the copilot off.
 *
 * Accessibility: the welcome and each step are modal dialogs that hold focus
 * and give it back where it was; Tab stays inside, Enter presses, Escape ends,
 * the arrow keys go back and forward; the step number is in the dialog's
 * description; with reduced motion the light moves without animating.
 */

/** Where the browser remembers that the tour ended. */
export const ENDED_KEY = "openokr.tour.ended";
/** The event Take the tour again sends. */
const START_EVENT = "openokr:tour-start";

interface Step {
  readonly id: string;
  /** Where the step's area is. The first visible match is lit. */
  readonly selector: string;
  readonly title: string;
  readonly body: string;
}

/** Q9: S-34's five, pointed at what the shell shows on every screen. */
const STEPS: readonly Step[] = [
  {
    id: "home",
    selector: 'nav a[href="/"]',
    title: "tour.home.title",
    body: "tour.home.body",
  },
  {
    id: "review",
    selector: 'nav a[href="/review"]',
    title: "tour.review.title",
    body: "tour.review.body",
  },
  {
    id: "goals",
    selector: 'nav a[href="/goals"]',
    title: "tour.goals.title",
    body: "tour.goals.body",
  },
  {
    id: "cycle-strip",
    // The shell's strip under the top bar alone, drawn while a cycle is being
    // planned. The Work Map's phase strip stays after publishing, further
    // down the page, and lit under these words it was out of place (Akmal,
    // 11 November 2026); outside planning the step is left out, as T1 says.
    selector: '[data-tour-target="cycle-strip"]',
    title: "tour.cycleStrip.title",
    body: "tour.cycleStrip.body",
  },
  {
    id: "search",
    selector: '.topbar-shell label:has(input[type="search"])',
    title: "tour.search.title",
    body: "tour.search.body",
  },
  {
    id: "ask",
    selector: '[data-tour-target="ask-ai"]',
    title: "tour.askAi.title",
    body: "tour.askAi.body",
  },
];

/** Space around the lit area, and between it and the card. */
const PAD = 6;
const GAP = 12;
const CARD_WIDTH = 320;

function visibleTarget(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      return element;
    }
  }
  return null;
}

function readEnded(): boolean {
  try {
    return window.localStorage.getItem(ENDED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberEnded(): void {
  try {
    window.localStorage.setItem(ENDED_KEY, "1");
  } catch {
    // A browser that refuses storage still has the member's own row.
  }
}

/** The focusable elements inside a dialog, for keeping Tab within it. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export function ProductTour({
  offered,
  demo,
  canDraft,
  askAvailable,
  instanceName,
}: {
  /** The member has not finished or ended the tour (`people.readOwnTour`). */
  readonly offered: boolean;
  /** `OPENOKR_DEMO=on`: the browser remembers, not the shared member. */
  readonly demo: boolean;
  /** May draft OKRs, so the last step opens the cycle page. */
  readonly canDraft: boolean;
  /** The copilot can answer, so the Ask AI step is worth showing. */
  readonly askAvailable: boolean;
  readonly instanceName: string;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const titleId = useId();
  const bodyId = useId();
  const [phase, setPhase] = useState<"idle" | "welcome" | "touring">("idle");
  const [steps, setSteps] = useState<readonly Step[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [, start] = useTransition();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  // Offered once the page is up, and only where neither the member nor this
  // browser has ended it. Read after mount, because storage is the browser's.
  useEffect(() => {
    const shouldOffer = demo ? !readEnded() : offered && !readEnded();
    if (shouldOffer) {
      returnTo.current = document.activeElement as HTMLElement | null;
      setPhase("welcome");
    }
  }, [offered, demo]);

  const begin = useCallback(() => {
    const present = STEPS.filter(
      (step) =>
        (step.id !== "ask" || askAvailable) && visibleTarget(step.selector),
    );
    if (present.length === 0) {
      setPhase("idle");
      return;
    }
    setSteps(present);
    setIndex(0);
    setPhase("touring");
  }, [askAvailable]);

  // Take the tour again, from the avatar menu.
  useEffect(() => {
    const again = () => {
      // Started from a menu item, which is gone once the menu closes: the
      // way back is the button that opened the menu (UAT 0.8.0, F-07).
      const active = document.activeElement as HTMLElement | null;
      returnTo.current = active?.closest('[role="menu"]')
        ? document.querySelector<HTMLElement>(
            '[aria-haspopup="menu"][aria-expanded="true"]',
          )
        : active;
      begin();
    };
    window.addEventListener(START_EVENT, again);
    return () => window.removeEventListener(START_EVENT, again);
  }, [begin]);

  const end = useCallback(
    (then?: () => void) => {
      rememberEnded();
      setPhase("idle");
      setRect(null);
      if (!demo) {
        start(async () => {
          await finishTour();
        });
      }
      if (then) {
        then();
      } else {
        returnTo.current?.focus?.();
      }
    },
    [demo],
  );

  const step = phase === "touring" ? steps[index] : undefined;

  // Light the step's area, and keep it lit through scrolling and resizing.
  useLayoutEffect(() => {
    if (!step) {
      return;
    }
    const place = () => {
      const target = visibleTarget(step.selector);
      if (!target) {
        setRect(null);
        return;
      }
      const box = target.getBoundingClientRect();
      setRect({
        top: box.top - PAD,
        left: box.left - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
      });
    };
    visibleTarget(step.selector)?.scrollIntoView({ block: "nearest" });
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [step]);

  // Focus the step's main button each time the dialog changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `index` is the trigger: each new step moves focus back to its main button, though the body does not read it.
  useEffect(() => {
    if (phase !== "idle") {
      primaryRef.current?.focus();
    }
  }, [phase, index]);

  const last = index === steps.length - 1;
  const next = () => {
    if (!last) {
      setIndex(index + 1);
      return;
    }
    if (canDraft) {
      end(() => router.push("/cycle"));
    } else {
      end();
    }
  };
  const back = () => setIndex(Math.max(0, index - 1));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      end();
      return;
    }
    if (phase === "touring" && event.key === "ArrowRight") {
      event.preventDefault();
      // Forward only: on the last step the next thing is leaving the page
      // or finishing, which is the button's to do (UAT 0.8.0 Q-5).
      if (!last) {
        next();
      }
      return;
    }
    if (phase === "touring" && event.key === "ArrowLeft") {
      event.preventDefault();
      back();
      return;
    }
    if (event.key === "Tab" && dialogRef.current) {
      const items = focusables(dialogRef.current);
      const first = items[0];
      const final = items[items.length - 1];
      if (!first || !final) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        final.focus();
      } else if (!event.shiftKey && document.activeElement === final) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  if (phase === "idle") {
    return null;
  }

  if (phase === "welcome") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-4.5">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          onKeyDown={onKeyDown}
          className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-(--shadow-popover)"
          data-testid="tour-welcome"
        >
          <h2 id={titleId} className="text-lg font-bold text-ink">
            {t("tour.welcome.title", { instance: instanceName })}
          </h2>
          <p id={bodyId} className="mt-1.5 text-sm text-ink-2">
            {t("tour.welcome.body")}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              ref={primaryRef}
              variant="primary"
              onClick={begin}
              data-testid="tour-start"
            >
              {t("tour.start")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => end()}
              data-testid="tour-skip"
            >
              {t("tour.skip")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!step) {
    return null;
  }

  // Beside a sidebar item, below anything else, and kept on screen. An area
  // in the lower half, such as the bottom bar on a phone, takes the card above
  // it, anchored by its bottom edge so its height need not be known; below
  // such an area it was drawn off the screen (UAT 0.8.0, F-02).
  const viewportWidth =
    typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 768 : window.innerHeight;
  const besideLeft =
    rect !== null &&
    rect.left < viewportWidth / 3 &&
    rect.left + rect.width + GAP + CARD_WIDTH < viewportWidth;
  const lowerHalf =
    rect !== null && rect.top + rect.height / 2 > viewportHeight / 2;
  const cardLeft = rect
    ? Math.min(Math.max(GAP, rect.left), viewportWidth - CARD_WIDTH - GAP)
    : 0;
  const cardStyle = rect
    ? besideLeft
      ? lowerHalf
        ? {
            bottom: Math.max(GAP, viewportHeight - rect.top - rect.height),
            left: rect.left + rect.width + GAP,
          }
        : { top: Math.max(GAP, rect.top), left: rect.left + rect.width + GAP }
      : lowerHalf
        ? { bottom: viewportHeight - rect.top + GAP, left: cardLeft }
        : { top: rect.top + rect.height + GAP, left: cardLeft }
    : { top: GAP * 6, left: Math.max(GAP, (viewportWidth - CARD_WIDTH) / 2) };

  return (
    <div className="fixed inset-0 z-50" data-testid="tour" data-step={step.id}>
      {/* Catches every press outside the card, so nothing behind is reached
          until the tour ends. */}
      <div className="absolute inset-0" />
      {rect ? (
        <div
          aria-hidden="true"
          data-testid="tour-light"
          className="pointer-events-none absolute rounded-lg ring-2 ring-brand motion-safe:transition-all motion-safe:duration-200"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 9999px rgb(15 23 42 / 0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-ink/55" aria-hidden="true" />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        className="absolute rounded-xl border border-line bg-surface p-4 shadow-(--shadow-popover)"
        style={{
          ...cardStyle,
          width: CARD_WIDTH,
          maxWidth: "calc(100vw - 24px)",
        }}
        data-testid="tour-card"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-sm font-semibold text-ink">
            {t(step.title)}
          </h2>
          <span
            className="flex-none text-xs text-ink-3 tabular-nums"
            data-testid="tour-count"
          >
            {t("tour.stepOf", { step: index + 1, count: steps.length })}
          </span>
        </div>
        <p id={bodyId} className="mt-1 text-sm text-ink-2">
          {t(step.body)}
          <span className="sr-only">
            {" "}
            {t("tour.stepOf", { step: index + 1, count: steps.length })}
          </span>
        </p>
        {/* Wraps rather than running past the card, whatever the language.
         * On the last step there is nothing left to skip, so the next
         * button's longer words have the row; Escape still ends the tour
         * (Akmal, 11 November 2026). */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {last ? (
            <span />
          ) : (
            <Button
              variant="ghost"
              onClick={() => end()}
              data-testid="tour-skip"
            >
              {t("tour.skip")}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {index > 0 ? (
              <Button variant="ghost" onClick={back} data-testid="tour-back">
                {t("tour.back")}
              </Button>
            ) : null}
            <Button
              ref={primaryRef}
              variant="primary"
              onClick={next}
              data-testid="tour-next"
            >
              {last
                ? canDraft
                  ? t("tour.startDrafting")
                  : t("tour.finish")
                : t("tour.next")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Starts the tour again, from anywhere: the avatar menu's entry calls this. */
export function startTourAgain(): void {
  window.dispatchEvent(new Event(START_EVENT));
}
