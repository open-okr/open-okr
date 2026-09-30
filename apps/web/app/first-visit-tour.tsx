"use client";

import { Button, Card, CardBody, useTranslations } from "@openokr/ui";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { finishTour } from "./tour-actions.ts";

/**
 * The first-visit tour (UIUX-PLAN S-34, completeness review L-08).
 *
 * S-34: "Per user on first visit: a five-stop tour covering the Work Map, the
 * review inbox, a check-in, the cycle strip and ⌘K." The stops below are those
 * five, in that order, and a test holds them to it.
 *
 * **A card on the Work Map, not an overlay over it.** The Work Map is where
 * every sign-in lands, so it is where a first visit happens. The card sits in
 * the page's own flow and traps nothing: somebody who would rather look around
 * on their own can ignore it and use every control on the screen, and a
 * keyboard reaches it where it is, under the page's heading and above the
 * tree. An overlay would have to trap focus and return it (§7), and would
 * stand between a new member and the screen it is trying to introduce.
 *
 * **Each stop outlines the thing it names, when that thing is on screen.** The
 * stop's id goes on the root element and `globals.css` draws the outline, so
 * no component elsewhere has to know a tour exists. A stop whose thing is not
 * on screen still reads correctly: the shell's cycle strip only exists while a
 * cycle is being planned, the search box is hidden on a phone, and a check-in
 * is a composer rather than something on this page.
 *
 * **Finishing and ending early are one write.** Either way the tour has been
 * offered, and it is not offered again on this machine or any other. The
 * member's own row remembers, through `people.finishOwnTour`.
 */

/** The five stops, in S-34's order. `id` is what `globals.css` outlines. */
export const TOUR_STOPS = [
  { id: "work-map", title: "tour.workMap.title", body: "tour.workMap.body" },
  { id: "review", title: "tour.review.title", body: "tour.review.body" },
  { id: "check-in", title: "tour.checkIn.title", body: "tour.checkIn.body" },
  {
    id: "cycle-strip",
    title: "tour.cycleStrip.title",
    body: "tour.cycleStrip.body",
  },
  { id: "search", title: "tour.search.title", body: "tour.search.body" },
] as const;

/** The attribute on `<html>` that says which stop is showing. */
const STOP_ATTRIBUTE = "data-tour-stop";

export function FirstVisitTour() {
  const { t } = useTranslations();
  const headingId = useId();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nextRef = useRef<HTMLButtonElement>(null);

  const stop = TOUR_STOPS[index];

  useEffect(() => {
    if (!open || !stop) {
      return;
    }
    const root = document.documentElement;
    root.setAttribute(STOP_ATTRIBUTE, stop.id);
    // Removed on the way out too, so leaving the Work Map mid-tour leaves no
    // outline behind on the next screen.
    return () => root.removeAttribute(STOP_ATTRIBUTE);
  }, [open, stop]);

  if (!open || !stop) {
    return null;
  }

  const last = index === TOUR_STOPS.length - 1;

  const finish = () => {
    setProblem(null);
    start(async () => {
      const result = await finishTour();
      if (result.error) {
        setProblem(result.error);
        return;
      }
      setOpen(false);
      // The card and the button that ended it are going, so focus goes to the
      // content they sat in rather than falling back to the document.
      document.getElementById("main-content")?.focus();
    });
  };

  const back = () => {
    const previous = Math.max(0, index - 1);
    setIndex(previous);
    // Back is disabled on the first stop, and a disabled button drops the
    // focus it held. Next is always there to take it.
    if (previous === 0) {
      nextRef.current?.focus();
    }
  };

  return (
    <section aria-labelledby={headingId} data-testid="first-visit-tour">
      <Card>
        <CardBody className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id={headingId} className="text-sm font-bold text-ink">
              {t("tour.title")}
            </h2>
            {/* Digits and a slash, the same in every language, as on S-34's
                own counter. The catalogue names it for a screen reader. */}
            <p className="text-xs text-ink-3" data-testid="tour-progress">
              <span className="sr-only">{t("tour.progress")}</span>
              {`${index + 1} / ${TOUR_STOPS.length}`}
            </p>
          </div>

          {/* Announced as a whole when the stop changes, because the buttons
              keep the focus and would otherwise move on in silence. */}
          <div
            aria-live="polite"
            aria-atomic="true"
            className="flex flex-col gap-1"
            data-testid="tour-stop"
            data-stop={stop.id}
          >
            <p className="text-sm font-semibold text-ink">{t(stop.title)}</p>
            <p className="text-sm text-ink-2">{t(stop.body)}</p>
          </div>

          {problem ? (
            <p role="alert" className="text-xs text-bad">
              {problem}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              ref={nextRef}
              type="button"
              variant="primary"
              size="sm"
              disabled={pending}
              data-testid="tour-next"
              onClick={last ? finish : () => setIndex(index + 1)}
            >
              {last ? t("tour.finish") : t("tour.next")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || index === 0}
              data-testid="tour-back"
              onClick={back}
            >
              {t("tour.back")}
            </Button>
            {/* Not on the last stop, where Done already is the same press. */}
            {last ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                data-testid="tour-end"
                onClick={finish}
              >
                {t("tour.end")}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
