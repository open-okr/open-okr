"use client";

import { cn, useTranslations } from "@openokr/ui";
import { reviewerIsChampion } from "./reviewer-is-champion.ts";

/**
 * The warning a goal's header, card or drawer shows when its reviewer is its
 * champion (plan 0.7.0, O3; okr-core-domain.md §4.1). Nothing at all when
 * somebody else reviews it, or nobody does.
 *
 * A client component so the server-rendered headers and the drawer, which is
 * drawn in the browser, render the one sentence the same way.
 */
export function ReviewerIsChampionNote({
  championId,
  reviewerId,
  name,
  className,
}: {
  readonly championId: string;
  readonly reviewerId: string | null | undefined;
  /** The champion's name, who is also the reviewer. */
  readonly name: string;
  readonly className?: string;
}) {
  const { t } = useTranslations();
  if (!reviewerIsChampion(championId, reviewerId)) {
    return null;
  }
  return (
    <p
      data-testid="reviewer-is-champion"
      className={cn(
        "rounded-control bg-warn-bg px-2 py-1 text-xs text-warn",
        className,
      )}
    >
      {t("goals.reviewerIsChampion", { name })}
    </p>
  );
}
