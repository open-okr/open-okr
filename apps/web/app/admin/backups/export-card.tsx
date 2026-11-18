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
  SecretInput,
  useTranslations,
} from "@openokr/ui";
import { useCallback, useState, useTransition } from "react";
import {
  type ExportResult,
  exportWorkspaceArchive,
} from "../imports/actions.ts";

export function ExportCard() {
  const { t } = useTranslations();

  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeFiles, setIncludeFiles] = useState(true);
  // What the archive is sealed under (H-18). Held in the page only: the server
  // uses it to seal and keeps nothing.
  const [passphrase, setPassphrase] = useState("");

  const handleExport = useCallback(() => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const answer = await exportWorkspaceArchive(includeFiles, passphrase);
      if (!answer.ok) {
        setError(answer.error);
        return;
      }
      setResult(answer.value);
    });
  }, [includeFiles, passphrase]);

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
      <CardHeader className="flex-col items-stretch gap-0.5">
        <h2 className="text-sm font-semibold text-ink">
          {t("admin.imports.exportCard.exportWorkspace")}
        </h2>
        <p className="max-w-prose text-xs text-ink-3">
          {t("admin.imports.exportCard.createsAnEncryptedArchive")}
        </p>
      </CardHeader>

      {!result ? (
        <>
          <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
            <div className="col-span-12">
              {/* The server's 12 to 1024 (workspace.exportArchive). */}
              <SecretInput
                label={t("admin.imports.exportCard.passphrase")}
                description={t("admin.imports.exportCard.passphraseHint")}
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </div>
            <label className="col-span-12 flex items-center gap-2 text-sm text-ink-3">
              <input
                type="checkbox"
                checked={includeFiles}
                onChange={(e) => setIncludeFiles(e.target.checked)}
              />
              {t("admin.imports.exportCard.includeFiles")}
            </label>
            {error ? (
              <p
                className="col-span-12 rounded-md bg-bad-bg px-3 py-2 text-sm font-medium text-bad"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </CardBody>
          <div className="flex flex-wrap items-center justify-end gap-3 border-line border-t px-3.5 py-2.5">
            <Button
              variant="primary"
              size="sm"
              onClick={handleExport}
              disabled={passphrase.length < 12}
              pending={pending}
            >
              {pending
                ? t("admin.imports.exportCard.exporting")
                : t("admin.imports.exportCard.exportWorkspace")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <CardBody className="flex flex-col gap-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-3">
                {t("admin.imports.exportCard.file")}
              </dt>
              <dd className="text-ink">{result.filename}</dd>
              <dt className="text-ink-3">
                {t("admin.imports.exportCard.size")}
              </dt>
              <dd className="text-ink">
                {t("admin.imports.exportCard.kb", {
                  bytes: (result.bytes / 1024).toFixed(1),
                })}
              </dd>
              <dt className="text-ink-3">
                {t("admin.imports.exportCard.rows")}
              </dt>
              <dd className="text-ink">{totalRows}</dd>
              <dt className="text-ink-3">{t("attachments.title")}</dt>
              <dd className="text-ink">{result.blobs.count}</dd>
              <dt className="text-ink-3">
                {t("admin.imports.exportCard.sha")}
              </dt>
              <dd className="font-mono text-xs text-ink-3 break-all">
                {result.digest}
              </dd>
            </dl>

            {result.missingFiles.length > 0 ? (
              <p className="text-xs text-warn">
                {t("admin.imports.exportCard.fileSCouldNotBe", {
                  length: result.missingFiles.length,
                })}
              </p>
            ) : null}
          </CardBody>
          <div className="flex flex-wrap items-center justify-end gap-2 border-line border-t px-3.5 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setResult(null);
                setError(null);
              }}
            >
              {t("admin.imports.exportCard.clear")}
            </Button>
            <Button variant="primary" size="sm" onClick={handleDownload}>
              {t("search.myExports.download")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
