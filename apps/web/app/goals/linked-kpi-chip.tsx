"use client";

import { Chip, useTranslations } from "@openokr/ui";
import Link from "next/link";

/**
 * A goal key result's linked KPI chip (0.10.0 K7 R16, docs/design/kpi-access.md).
 *
 * When the KPI is visible to the reader, renders its title and a link to the KPI.
 * When the KPI is hidden ("cannot see"), renders "A KPI you cannot see" with no
 * title and no link (R16, Q4).
 */
export function LinkedKpiChip({
  kpiId: _kpiId,
  kpi,
}: {
  readonly kpiId: string;
  readonly kpi?: { readonly id: string; readonly title: string } | null;
}) {
  const { t } = useTranslations();

  if (!kpi) {
    return (
      <Chip tone="neutral" data-testid="kpi-hidden-chip">
        {t("goals.detail.hiddenKpi")}
      </Chip>
    );
  }

  return (
    <Link
      href={`/kpis/${kpi.id}`}
      data-testid="kpi-visible-chip"
      className="inline-flex hover:underline"
    >
      <Chip tone="info">{kpi.title}</Chip>
    </Link>
  );
}
