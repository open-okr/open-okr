import type { Metadata } from "next";
import { getPool } from "./auth";
import { getTranslations } from "./translations";
import { requireWorkspace } from "./workspace";

/**
 * The browser tab's title for a screen (3 November 2026).
 *
 * The root layout's template adds the instance's name after it, so a tab reads
 * "KPIs · OKRGoal" and a row of tabs can be told apart. Every tab used to read
 * the instance's name alone.
 *
 * The screen's name comes first because a narrow tab keeps only the start of
 * its title.
 */
export function pageTitle(key: string): () => Promise<Metadata> {
  return async () => {
    const { t } = await getTranslations();
    return { title: t(key) };
  };
}

type MemberContext = {
  readonly pool: ReturnType<typeof getPool>;
  readonly workspaceId: string;
  readonly actor: { readonly kind: "human"; readonly userId: string };
};

/**
 * The tab title of one item's page: its own name, read through the same
 * access-scoped action the page reads it with, so a title never names
 * something the reader may not open. Anything that refuses, a forbidden item,
 * one that is gone, no session, falls back to the kind of page ("Objective"),
 * and the page itself then answers not-found as it always has.
 */
export async function itemTitle(
  fallbackKey: string,
  read: (context: MemberContext) => Promise<string | null | undefined>,
): Promise<Metadata> {
  const { t } = await getTranslations();
  try {
    const { session, workspace } = await requireWorkspace();
    const name = await read({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
    if (name && name.trim() !== "") {
      return { title: name.trim() };
    }
  } catch {
    // Refused or missing: the page's own read answers that, not the title.
  }
  return { title: t(fallbackKey) };
}
