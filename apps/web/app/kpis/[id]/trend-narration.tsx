"use client";

/**
 * The trend narration, beside the chart it narrates (AI-NATIVE-PLAN §2.2,
 * UIUX-PLAN S-21, completeness review M-09).
 *
 * `kpis.narrateTrend` was built at P4-T15b-a and nothing called it. The
 * chart above is the record and stays exactly as it is; this adds a
 * paragraph and the movements that stood out, and only when the page decided
 * a provider can write them. A narration that stated a figure the series does
 * not hold never reaches here: the action refuses it.
 */
import { useTranslations } from "@openokr/ui";
import { AssistReading } from "../../../lib/assist-reading.tsx";
import { narrateTrendAction } from "./actions.ts";

export function TrendNarration({ kpiId }: { readonly kpiId: string }) {
  const { t } = useTranslations();
  return (
    <AssistReading
      testId="trend-narration"
      label={t("kpis.detail.trend.narrate")}
      note={t("kpis.detail.trend.sameNumbersAsTheChart")}
      pointsHeading={t("kpis.detail.trend.whatStoodOut")}
      read={async () => {
        const narrated = await narrateTrendAction(kpiId);
        return narrated
          ? { text: narrated.narrative, points: narrated.anomalies }
          : null;
      }}
    />
  );
}
