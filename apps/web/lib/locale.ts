import { callAction } from "@openokr/core";
import type { Locale } from "@openokr/ui";
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
 * The order is the member, then the workspace, then English. A member's own
 * answer wins because it is the more specific one; the workspace's is what a
 * member who has never chosen should get, because an organisation that set a
 * language meant it for the people in it.
 *
 * **It never throws, and that is the whole reason it is a function.** The root
 * layout wraps the signed-out screens too: sign-in, password reset, the device
 * page and the first-run wizard have no member and often no workspace.
 * `requireWorkspace()` raises for all of them, so a locale resolved inline in
 * the layout would turn every signed-out screen into an error. English is the
 * answer for a visitor the product does not know yet.
 */
export async function resolveLocale(): Promise<Locale> {
  try {
    const { session, workspace } = await requireWorkspace();
    const me = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "people.readMember",
      { memberId: workspace.memberId },
    );
    if (me.language === "en" || me.language === "ms") {
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
    if (workspaceLanguage === "en" || workspaceLanguage === "ms") {
      return workspaceLanguage;
    }
    return "en";
  } catch {
    return "en";
  }
}
