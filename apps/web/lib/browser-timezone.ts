import { browserTimezoneFromCookies } from "@openokr/core";
import { headers } from "next/headers";

/**
 * The timezone this request's browser reported, as a listed zone, or
 * `undefined` (docs/design/browser-timezone.md). `BrowserTimezoneCookie` in
 * the root layout writes it; the pages that make a workspace or a member read
 * it here, the way the sign-up hook reads it in `packages/core`.
 */
export async function requestBrowserTimezone(): Promise<string | undefined> {
  return browserTimezoneFromCookies((await headers()).get("cookie"));
}
