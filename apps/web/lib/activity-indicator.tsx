"use client";

import { useTranslations } from "@openokr/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import { NAVIGATION_STALL_MS } from "./nav-link.tsx";
import { createRequestActivity } from "./request-activity.ts";

/**
 * How long a request may run before the bar appears. A save that answers
 * faster than this needs no bar, and one that flashes for a frame reads as a
 * glitch. A UI timing, not a practice setting.
 */
const ACTIVITY_DELAY_MS = 200;

const activity = createRequestActivity();
let installed = false;

/** Wraps `window.fetch` once, however many times the shell mounts. */
function install(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  window.fetch = activity.wrap(window.fetch.bind(window));
}

const serverCount = () => 0;

/**
 * The bar across the top of the window while the server works on something a
 * person did: a save, a create, an edit, the refresh after any of them
 * (UIUX-PLAN.md §4, "Acting"). The sidebar's links already had one; every
 * other click had nothing, so a slow save and a button that was never pressed
 * looked the same (owner, 4 November 2026).
 *
 * The same bar as a navigation, so a person learns one signal. After
 * `NAVIGATION_STALL_MS`, or when the browser goes offline, a message says the
 * server has not answered. It offers no reload: what was sent may still land,
 * and a reload would throw away anything typed since.
 */
export function ActivityIndicator() {
  const { t } = useTranslations();
  useEffect(install, []);
  const busy =
    useSyncExternalStore(activity.subscribe, activity.count, serverCount) > 0;
  const [shown, setShown] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!busy) {
      setShown(false);
      setStalled(false);
      setOffline(false);
      return;
    }
    setOffline(!navigator.onLine);
    const markOffline = () => setOffline(true);
    window.addEventListener("offline", markOffline);
    const show = window.setTimeout(() => setShown(true), ACTIVITY_DELAY_MS);
    const stall = window.setTimeout(
      () => setStalled(true),
      NAVIGATION_STALL_MS,
    );
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(stall);
      window.removeEventListener("offline", markOffline);
    };
  }, [busy]);

  if (!busy || !(shown || offline)) {
    return null;
  }
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="activity-progress"
        className="nav-progress pointer-events-none fixed left-0 top-0 z-50 h-0.5 bg-brand"
      />
      {stalled || offline ? (
        <div
          role="alert"
          data-testid="activity-stalled"
          className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-lg"
        >
          {offline ? t("shell.activity.offline") : t("shell.activity.stalled")}
        </div>
      ) : null}
    </>
  );
}
