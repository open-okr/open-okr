import {
  resolveInstanceDefaultLanguage,
  resolveMemberLanguage,
} from "@openokr/core";
import { isShippedLocale, SHIPPED_LOCALES } from "@openokr/formats";
import type { Locale } from "@openokr/ui";
import { cookies, headers } from "next/headers";
import { browserLocale } from "./accept-language.ts";
import { getPool } from "./pool";
import { requireWorkspace } from "./workspace";

export const VISITOR_LANGUAGE_COOKIE = "openokr_locale";

/**
 * Which catalogue this request renders in (UIUX-PLAN §8, P6-G22a).
 *
 * **The root layout has pinned `en` since P2-T10.** `TranslationsProvider`
 * takes a locale, `CATALOGUES` carries a stubbed `ms`, the workspace has had a
 * `language` setting since the same task, and nothing ever selected anything:
 * the one place that decides was a literal.
 *
 * **Signed in**, the order is the member, workspace, instance, then English. A
 * member's own answer wins because it is the more specific one; the
 * workspace's is what a member who has never chosen should get, because an
 * organisation that set a language meant it for the people in it.
 *
 * **Signed out**, or signed in with no workspace yet, there is nobody to ask,
 * so the order is the saved choice, the browser's language when the product
 * ships it, then the instance's, then English (languages design section 8). A
 * Malay visitor to an English instance read its sign-in in English, which is
 * what the 0.8.0 acceptance test reported.
 *
 * **It never throws, and that is the whole reason it is a function.** The root
 * layout wraps the signed-out screens too: sign-in, password reset, the device
 * page and the first-run wizard have no member and often no workspace.
 * `requireWorkspace()` raises for all of them, so a locale resolved inline in
 * the layout would turn every signed-out screen into an error.
 */
export async function resolveLocale(): Promise<Locale> {
  let signedIn: Awaited<ReturnType<typeof requireWorkspace>>;
  try {
    signedIn = await requireWorkspace();
  } catch {
    return visitorLocale();
  }

  const { session, workspace } = signedIn;
  try {
    const lang = await resolveMemberLanguage(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      workspace.memberId,
    );
    if (isShippedLocale(lang)) {
      return lang;
    }
  } catch {
    return "en";
  }
  return "en";
}

/**
 * A visitor can override the browser's language. Unavailable values are
 * skipped at each step, including a stale cookie after a downgrade.
 */
export async function visitorLocaleFromRequest(): Promise<Locale | undefined> {
  try {
    const saved = (await cookies()).get(VISITOR_LANGUAGE_COOKIE)?.value;
    if (isShippedLocale(saved)) {
      return saved;
    }
  } catch {
    // The function can be called without a request, including during a build.
  }
  try {
    const browser = browserLocale(
      (await headers()).get("accept-language"),
      SHIPPED_LOCALES,
    );
    if (browser && isShippedLocale(browser)) {
      return browser;
    }
  } catch {
    // No request to read, as in a build.
  }
  return undefined;
}

async function visitorLocale(): Promise<Locale> {
  const requestLocale = await visitorLocaleFromRequest();
  if (requestLocale) {
    return requestLocale;
  }
  try {
    const instance = await resolveInstanceDefaultLanguage(getPool());
    if (isShippedLocale(instance)) {
      return instance;
    }
  } catch {
    // The database did not answer. English, as for anybody unknown.
  }
  return "en";
}
