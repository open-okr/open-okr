"use client";

import { Button, useTranslations } from "@openokr/ui";
import Link, { useLinkStatus } from "next/link";
import { type ComponentProps, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * How long a navigation may wait before the reader is told the server is not
 * answering. A UI timing, not a practice setting: it decides when a message
 * appears, never what the product does.
 */
export const NAVIGATION_STALL_MS = 10_000;

/**
 * The shell's link, with feedback while the next page is on its way.
 *
 * **A click on the sidebar used to look ignored.** Each segment has a
 * `loading.tsx`, but its skeleton only appears once the server has answered
 * with the route's shell. A slow or unreachable server left the old page on
 * screen with nothing to say the click had landed, and no message ever came.
 */
export function NavLink({
  href,
  className,
  children,
}: ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={className}>
      {children}
      <NavigationPending href={typeof href === "string" ? href : null} />
    </Link>
  );
}

/**
 * Renders nothing in the link's own flow, so the row never shifts. While the
 * navigation is pending: a bar across the top of the window, then, if it is
 * still pending after `NAVIGATION_STALL_MS` or the browser is offline, a
 * message with a full reload to try again.
 */
function NavigationPending({ href }: { readonly href: string | null }) {
  const { pending } = useLinkStatus();
  const { t } = useTranslations();
  const [stalled, setStalled] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!pending) {
      setStalled(false);
      setOffline(false);
      return;
    }
    setOffline(!navigator.onLine);
    const markOffline = () => setOffline(true);
    window.addEventListener("offline", markOffline);
    const timer = window.setTimeout(
      () => setStalled(true),
      NAVIGATION_STALL_MS,
    );
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("offline", markOffline);
    };
  }, [pending]);

  if (!pending) {
    return null;
  }

  // Portalled to the body: a bar and a button inside the link's own `<a>`
  // would be interactive content nested in interactive content.
  return createPortal(
    <>
      <span
        aria-hidden="true"
        data-testid="navigation-progress"
        className="nav-progress pointer-events-none fixed left-0 top-0 z-50 h-0.5 bg-brand"
      />
      {stalled || offline ? (
        // A live region, so a screen reader hears it without moving focus.
        // React bubbles a portalled click to the link that rendered it, so
        // the retry stops it there.
        <div
          role="alert"
          data-testid="navigation-stalled"
          className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-lg"
        >
          <span>
            {offline
              ? t("shell.navigation.offline")
              : t("shell.navigation.stalled")}
          </span>
          {href ? (
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                window.location.assign(href);
              }}
            >
              {t("shell.navigation.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
