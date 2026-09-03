"use client";

import { useState, useTransition } from "react";

/**
 * Taking a list away as a file (UIUX-PLAN.md §4, P5-T13).
 *
 * **The file is built on the server and handed over as a download here.** The
 * rows come from `exports.list`, which reads through the same actions the
 * screen reads, so a file can never carry a row the page would have hidden.
 *
 * **A large set is queued, and the button says so rather than pretending.** The
 * action returns `queued` with no file when the list is bigger than one request
 * should build; the row it enqueued is what will produce the file, and the
 * worker that delivers it is P5-T15's along with the spreadsheet format. Saying
 * "this is being prepared" is honest; a spinner that never ends is not.
 */
export interface ExportOutcome {
  readonly filename: string;
  readonly csv: string | null;
  readonly rowCount: number;
  readonly queued: boolean;
  readonly error: string | null;
}

export function ExportButton({
  label = "Export as CSV",
  onExport,
}: {
  readonly label?: string;
  readonly onExport: () => Promise<ExportOutcome>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const outcome = await onExport();
            if (outcome.error) {
              setError(outcome.error);
              return;
            }
            if (outcome.queued || !outcome.csv) {
              setMessage(
                `${outcome.rowCount} rows is too many to build here. It is being prepared.`,
              );
              return;
            }
            download(outcome.filename, outcome.csv);
            setMessage(
              `${outcome.rowCount} ${outcome.rowCount === 1 ? "row" : "rows"} downloaded.`,
            );
          });
        }}
        className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand disabled:text-ink-4"
      >
        {pending ? "Preparing…" : label}
      </button>
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
 * Hands the bytes to the browser.
 *
 * A blob and an anchor rather than a route, because the file was built in the
 * action's own answer and a second request would build it twice. The object URL
 * is revoked straight after: the browser has the bytes by then.
 */
function download(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
