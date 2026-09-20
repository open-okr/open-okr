"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useState } from "react";
import { type ChainResult, exportAudit, verifyChain } from "./actions";

/**
 * The verification button and the export form (P8-T10).
 *
 * **The file is built on the server and handed over here.** The action has
 * already assembled it, and a download route would assemble it a second time
 * to answer a question this answer already holds. The same trade
 * `exports.list` makes.
 */

const INPUT_CLASS =
  "rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line";

const LABEL_CLASS =
  "flex w-full flex-col gap-1 text-xs font-semibold text-ink-2";

export function AuditPanel() {
  const { t } = useTranslations();
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<ChainResult | null>(null);

  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const check = async () => {
    setChecking(true);
    setVerdict(null);
    try {
      setVerdict(await verifyChain());
    } finally {
      setChecking(false);
    }
  };

  const download = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setExporting(true);
    setNote("");
    setError("");

    const form = new FormData(event.currentTarget);
    const value = (name: string) => {
      const raw = String(form.get(name) ?? "").trim();
      return raw === "" ? undefined : raw;
    };

    try {
      const result = await exportAudit({
        ...(value("from") ? { from: value("from") as string } : {}),
        ...(value("to") ? { to: value("to") as string } : {}),
        ...(value("action") ? { action: value("action") as string } : {}),
        ...(value("targetType")
          ? { targetType: value("targetType") as string }
          : {}),
      });

      if (result.error || !result.csv || !result.filename) {
        setError(result.error ?? t("admin.audit.exportEmpty"));
        return;
      }

      // A blob rather than a link to a route: the bytes are already here.
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);

      setNote(
        result.truncated
          ? `${result.rowCount} rows, which is the ceiling. Narrow the range to see the rest.`
          : `${result.rowCount} rows.`,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-start gap-3">
        <h3 className="text-sm font-bold text-ink">
          {t("admin.audit.checkTheChain")}
        </h3>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={checking}
          onClick={check}
        >
          {checking ? t("admin.audit.checking") : t("admin.audit.verify")}
        </Button>

        {verdict ? (
          <p
            role="status"
            data-testid="chain-verdict"
            className={
              verdict.ok && !verdict.error
                ? "rounded-md bg-ok-bg px-2.5 py-1.5 text-sm font-medium text-ok"
                : "rounded-md bg-red-50 px-2.5 py-1.5 text-sm font-medium text-red-700"
            }
          >
            {verdict.error
              ? verdict.error
              : verdict.ok
                ? `The chain is intact. ${verdict.checked} rows checked, ${verdict.pending} waiting for a position.`
                : `The chain is broken at position ${verdict.brokenAtSeq ?? "unknown"}. ${verdict.reason ?? ""}`}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="text-sm font-bold text-ink">
          {t("admin.audit.exportTheTrail")}
        </h3>
        <p className="max-w-prose text-sm text-ink-3">
          {t("admin.audit.exportIntro")}
        </p>

        <form onSubmit={download} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label htmlFor="audit-from" className={LABEL_CLASS}>
              {t("admin.audit.from")}
              <input
                id="audit-from"
                name="from"
                type="date"
                className={INPUT_CLASS}
              />
            </label>
            <label htmlFor="audit-to" className={LABEL_CLASS}>
              {t("admin.audit.to")}
              <input
                id="audit-to"
                name="to"
                type="date"
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label htmlFor="audit-action" className={LABEL_CLASS}>
              {t("admin.audit.action")}
              <input
                id="audit-action"
                name="action"
                placeholder={t("admin.audit.actionPlaceholder")}
                className={INPUT_CLASS}
              />
            </label>
            <label htmlFor="audit-target-type" className={LABEL_CLASS}>
              {t("admin.audit.targetType")}
              <input
                id="audit-target-type"
                name="targetType"
                placeholder={t("admin.audit.targetTypePlaceholder")}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={exporting}
            >
              {exporting
                ? t("admin.audit.building")
                : t("admin.audit.exportAsCsv")}
            </Button>
            {note ? (
              <p
                role="status"
                data-testid="export-note"
                className="text-sm text-ink-3"
              >
                {note}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
