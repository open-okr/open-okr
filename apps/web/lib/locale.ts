import { callAction, resolveInstanceDefaultLanguage } from "@openokr/core";
import { CATALOGUES, type Locale } from "@openokr/ui";
import { headers } from "next/headers";
import { browserLocale } from "./accept-language.ts";
import { getPool } from "./pool";
import { requireWorkspace } from "./workspace";

/**
 * Which catalogue this request renders in (UIUX-PLAN §8, P6-G22a).
 *
 * **The root layout has pinned `en` since P2-T10.** `TranslationsProvider`
 * takes a locale, `CATALOGUES` carries a stubbed `ms`, the workspace has had a
 * `language` setting since the same task, and nothing ever selected anything:
 * the one place that decides was a literal.
 *
 * **Signed in**, the order is the member, then the workspace, then English. A
 * member's own answer wins because it is the more specific one; the
 * workspace's is what a member who has never chosen should get, because an
 * organisation that set a language meant it for the people in it.
 *
 * **Signed out**, or signed in with no workspace yet, there is nobody to ask,
 * so the order is the browser's language when the product ships it, then the
 * instance's, then English (Q-8, decided by Akmal on 12 November 2026). A
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
    const me = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "people.readMember",
      { memberId: workspace.memberId },
    );
    if (isShipped(me.language)) {
      return me.language;
    }

    const settings = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "settings.readWorkspaceSettings",
      {},
    );
    const workspaceLanguage = settings.settings.language;
    if (isShipped(workspaceLanguage)) {
      return workspaceLanguage;
    }
    return "en";
  } catch {
    return "en";
  }
}

/** The languages the product has a catalogue for: today `en` and `ms`. */
const SHIPPED = Object.keys(CATALOGUES) as Locale[];

function isShipped(language: unknown): language is Locale {
  return SHIPPED.includes(language as Locale);
}

/**
 * A visitor's language: the browser's when shipped, then the instance's, then
 * English. Each step that cannot be read is passed over rather than raised.
 */
async function visitorLocale(): Promise<Locale> {
  try {
    const browser = browserLocale(
      (await headers()).get("accept-language"),
      SHIPPED,
    );
    if (browser) {
      return browser;
    }
  } catch {
    // No request to read, as in a build. The instance's language is next.
  }
  try {
    const instance = await resolveInstanceDefaultLanguage(getPool());
    if (isShipped(instance)) {
      return instance;
    }
  } catch {
    // The database did not answer. English, as for anybody unknown.
  }
  return "en";
}
