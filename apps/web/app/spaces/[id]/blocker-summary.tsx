"use client";

/**
 * The blocker summary, above the board it summarises (AI-NATIVE-PLAN §2.2,
 * completeness review M-09).
 *
 * The board below it is ranked by §11's ladder and stays exactly as it is.
 * The summary is prose about that list, in that order; one that quoted a next
 * action not on the board was refused before it got here.
 */
import { useTranslations } from "@openokr/ui";
import { AssistReading } from "../../../lib/assist-reading.tsx";
import { summariseBlockersAction } from "./assist-actions.ts";

export function BlockerSummary({ spaceId }: { readonly spaceId: string }) {
  const { t } = useTranslations();
  return (
    <AssistReading
      testId="blocker-summary"
      label={t("spaces.detail.blockers.summarise")}
      note={t("spaces.detail.blockers.inTheBoardsOrder")}
      pointsHeading=""
      read={async () => {
        const summarised = await summariseBlockersAction(spaceId);
        return summarised ? { text: summarised.summary, points: [] } : null;
      }}
    />
  );
}
