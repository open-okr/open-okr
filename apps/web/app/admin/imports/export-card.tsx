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

import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { useCallback, useState, useTransition } from "react";
import { type ExportResult, exportWorkspaceArchive } from "./actions.ts";

export function ExportCard() {
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
        <h3 className="text-sm font-bold text-ink">Export workspace</h3>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-3">
          Creates an encrypted archive of this workspace. The file holds every
          goal, check-in, session, document and setting, sealed with this
          instance's encryption key.
        </p>

        {!result ? (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-3">
              <input
                type="checkbox"
                checked={includeFiles}
                onChange={(e) => setIncludeFiles(e.target.checked)}
              />
              Include files
            </label>
            <Button variant="primary" onClick={handleExport} disabled={pending}>
              {pending ? "Exporting..." : "Export workspace"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-3">File</dt>
              <dd className="text-ink">{result.filename}</dd>
              <dt className="text-ink-3">Size</dt>
              <dd className="text-ink">
                {(result.bytes / 1024).toFixed(1)} KB
              </dd>
              <dt className="text-ink-3">Rows</dt>
              <dd className="text-ink">{totalRows}</dd>
              <dt className="text-ink-3">Files</dt>
              <dd className="text-ink">{result.blobs.count}</dd>
              <dt className="text-ink-3">SHA-256</dt>
              <dd className="font-mono text-xs text-ink-3 break-all">
                {result.digest}
              </dd>
            </dl>

            {result.missingFiles.length > 0 ? (
              <p className="text-xs text-warn">
                {result.missingFiles.length} file(s) could not be read and are
                not in the archive.
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button variant="primary" onClick={handleDownload}>
                Download
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                Clear
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
