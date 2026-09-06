"use client";

import { useState, useTransition } from "react";

/**
 * Taking a list away as a file (UIUX-PLAN.md §4, P5-T13, both formats and the
 * queued path at P5-T15).
 *
 * **The file is built on the server and handed over as a download here.** The
 * rows come from `exports.list`, which reads through the same actions the
 * screen reads, so a file can never carry a row the page would have hidden.
 *
 * **Two formats behind one control.** A menu rather than two buttons: the
 * decision is which format, not whether to export twice, and two buttons side
 * by side read as two different actions.
 *
 * **A large set is queued, and the button says where it will appear.** The
 * action returns `queued` with no file when the list is bigger than one request
 * should build; the relay builds it and it lands in the list below. Saying
 * "this is being prepared, and here is where to find it" is honest; a spinner
 * that never ends is not.
 */
export interface ExportOutcome {
  readonly filename: string;
  readonly csv: string | null;
  readonly xlsxBase64: string | null;
  readonly rowCount: number;
  readonly queued: boolean;
  readonly runId: string | null;
  readonly error: string | null;
}

export type ExportFormat = "csv" | "xlsx";

const LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  xlsx: "Excel",
};

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function ExportButton({
  label = "Export",
  onExport,
}: {
  readonly label?: string;
  readonly onExport: (format: ExportFormat) => Promise<ExportOutcome>;
}) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor="export-format">
          Export format
        </label>
        <select
          id="export-format"
          value={format}
          disabled={pending}
          onChange={(event) => {
            setFormat(event.target.value as ExportFormat);
            setMessage(null);
            setError(null);
          }}
          className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink-2"
        >
          {(Object.keys(LABELS) as ExportFormat[]).map((one) => (
            <option key={one} value={one}>
              {LABELS[one]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const outcome = await onExport(format);
              if (outcome.error) {
                setError(outcome.error);
                return;
              }
              const bytes = decode(outcome, format);
              if (outcome.queued || !bytes) {
                setMessage(
                  `${outcome.rowCount} rows is too many to build here. It is being prepared and will appear under Your exports.`,
                );
                return;
              }
              download(outcome.filename, bytes, CONTENT_TYPES[format]);
              setMessage(
                `${outcome.rowCount} ${outcome.rowCount === 1 ? "row" : "rows"} downloaded.`,
              );
            });
          }}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand disabled:text-ink-4"
        >
          {pending ? "Preparing…" : label}
        </button>
      </span>
      {message ? (
        <span className="text-xs text-ink-3" data-testid="export-result">
          {message}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The file's bytes, whichever field carried them.
 *
 * A CSV travels as text because it is text; a workbook travels as base64
 * because it is not. Both end up as a blob the browser saves.
 */
function decode(outcome: ExportOutcome, format: ExportFormat): BlobPart | null {
  if (format === "csv") {
    return outcome.csv;
  }
  if (!outcome.xlsxBase64) {
    return null;
  }
  const binary = atob(outcome.xlsxBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Hands the bytes to the browser.
 *
 * A blob and an anchor rather than a route, because the file was built in the
 * action's own answer and a second request would build it twice. The object URL
 * is revoked straight after: the browser has the bytes by then.
 */
function download(filename: string, body: BlobPart, contentType: string): void {
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
