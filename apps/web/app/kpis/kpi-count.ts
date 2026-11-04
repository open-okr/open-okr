/**
 * "1 KPI", "4 KPIs". The catalogue's `common.kpis` has one form and read
 * "1 KPIs" on its own. A plain module, so the server page and the client
 * grid both call it.
 */
export function kpiCount(
  t: (key: string, values?: Record<string, string | number>) => string,
  length: number,
): string {
  return length === 1
    ? t("kpis.countOne", { length })
    : t("common.kpis", { length });
}
