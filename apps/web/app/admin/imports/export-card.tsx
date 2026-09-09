"use client";

/**
 * The workspace export card (UIUX-PLAN.md SS6 S-36, P6-T05c).
 *
 * One button, one result. The archive is built on the server and returned as
 * base64. The download is created client-side from that base64 so the browser
 * handles the save dialog. Reloading the page clears the result: the archive
 * is not stored on the server beyond the export_runs row that records it was
 * taken.
 */

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import { useCallback, useState, useTransition } from "react";
import { type ExportResult, exportWorkspaceArchive } from "./actions.ts";

export function ExportCard() {
  const { t } = useTranslations();

  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeFiles, setIncludeFiles] = useState(true);

  const handleExport = useCallback(() => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const answer = await exportWorkspaceArchive(includeFiles);
      if (!answer.ok) {
        setError(answer.error);
        return;
      }
      setResult(answer.value);
    });
  }, [includeFiles]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const bytes = Uint8Array.from(atob(result.archiveBase64), (c) =>
      c.charCodeAt(0),
    );
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const totalRows = result
    ? Object.values(result.counts).reduce((sum, n) => sum + n, 0)
    : 0;

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-bold text-ink">
          {t("admin.imports.exportCard.exportWorkspace")}
        </h3>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-3">
          {t("admin.imports.exportCard.createsAnEncryptedArchive")}
        </p>

        {!result ? (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-3">
              <input
                type="checkbox"
                checked={includeFiles}
                onChange={(e) => setIncludeFiles(e.target.checked)}
              />
              {t("admin.imports.exportCard.includeFiles")}
            </label>
            <Button variant="primary" onClick={handleExport} disabled={pending}>
              {pending ? "Exporting..." : "Export workspace"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-3">
                {t("admin.imports.exportCard.file")}
              </dt>
              <dd className="text-ink">{result.filename}</dd>
              <dt className="text-ink-3">
                {t("admin.imports.exportCard.size")}
              </dt>
              <dd className="text-ink">
                {(result.bytes / 1024).toFixed(1)}{" "}
                {t("admin.imports.exportCard.kb")}
              </dd>
              <dt className="text-ink-3">
                {t("admin.imports.exportCard.rows")}
              </dt>
              <dd className="text-ink">{totalRows}</dd>
              <dt className="text-ink-3">{t("attachments.title")}</dt>
              <dd className="text-ink">{result.blobs.count}</dd>
              <dt className="text-ink-3">
                {t("admin.imports.exportCard.sha256")}
              </dt>
              <dd className="font-mono text-xs text-ink-3 break-all">
                {result.digest}
              </dd>
            </dl>

            {result.missingFiles.length > 0 ? (
              <p className="text-xs text-warn">
                {result.missingFiles.length}{" "}
                {t("admin.imports.exportCard.fileSCouldNot")}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button variant="primary" onClick={handleDownload}>
                {t("search.myExports.download")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                {t("admin.imports.exportCard.clear")}
              </Button>
            </div>
          </div>
        )}

        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
