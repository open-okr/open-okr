"use client";

import { BROWSER_TIMEZONE_COOKIE } from "@openokr/formats";
import { useEffect } from "react";

/** A year. Long enough to outlive any sign-up; rewritten when it differs. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Tells the server which timezone this browser keeps (TECHNICAL-PLAN §4.14,
 * docs/design/browser-timezone.md).
 *
 * Only the browser knows it, and the server needs it at the moment it makes a
 * workspace or a member: the sign-up hook, the setup wizard, a join link. So
 * it is written into a first-party cookie on every page, and each of those
 * requests carries it. Written only when missing or different: somebody who
 * travels joins the next workspace in the zone they are in, and nothing
 * already made changes, because only creation reads it.
 *
 * After hydration, so a page with no script writes nothing and the specified
 * fallback, UTC or the workspace's zone, applies.
 */
export function BrowserTimezoneCookie(): null {
  useEffect(() => {
    let zone: string;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone) {
      return;
    }
    const pair = `${BROWSER_TIMEZONE_COOKIE}=${encodeURIComponent(zone)}`;
    if (document.cookie.split(";").some((part) => part.trim() === pair)) {
      return;
    }
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing from Firefox, and this is one non-secret value the server reads at sign-up
    document.cookie = `${pair}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax${secure}`;
  }, []);
  return null;
}
