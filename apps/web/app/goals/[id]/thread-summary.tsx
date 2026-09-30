"use client";

/**
 * The discussion, summarised (AI-NATIVE-PLAN §2.4, completeness review M-09).
 *
 * §2.4 promised "summarise a thread" and no task built it. It sits above the
 * thread it summarises, which stays exactly as it is below: the summary is a
 * way in, never a replacement. A summary that put words in quotation marks
 * that nobody in the thread wrote was refused before it got here.
 */
import { useTranslations } from "@openokr/ui";
import { AssistReading } from "../../../lib/assist-reading.tsx";
import { summariseThreadAction } from "./assist-actions.ts";

export function ThreadSummary({ goalId }: { readonly goalId: string }) {
  const { t } = useTranslations();
  return (
    <AssistReading
      testId="thread-summary"
      label={t("goals.detail.threadSummary.summarise")}
      note={t("goals.detail.threadSummary.theThreadIsBelow")}
      pointsHeading={t("goals.detail.threadSummary.stillOpen")}
      read={async () => {
        const summarised = await summariseThreadAction(goalId);
        return summarised
          ? { text: summarised.summary, points: summarised.openQuestions }
          : null;
      }}
    />
  );
}
