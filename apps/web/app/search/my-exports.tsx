/**
 * Where a queued export is collected (TECHNICAL-PLAN §4.13, P5-T15).
 *
 * **This exists because the request that asked for the file has already
 * returned.** Above the inline limit nothing is built in the request, so
 * without somewhere to come back to a person would have to keep the tab open
 * and hope. This is the row that says whether it arrived.
 *
 * **Their own exports, and there is no wider view.** Each file holds exactly
 * the rows that member could see when the worker built it, so nobody else may
 * collect it, an administrator included. The read filters on the caller's own
 * member row and takes no parameter that widens it.
 *
 * **Rendered on the server with no polling.** A run finishes in seconds and the
 * page is reloaded by the download itself or by the next navigation. A poll
 * would spend a request every few seconds on every open goals page for a state
 * that changes once.
 */
import { myExportsAction } from "./actions.ts";

const STATE_TEXT = {
  queued: "Being prepared",
  building: "Being prepared",
  ready: "Ready",
  failed: "Failed",
} as const;

export async function MyExports() {
  const runs = await myExportsAction();
  const queuedOrDone = runs.filter(
    (run) => run.state !== "ready" || run.blobId,
  );

  if (queuedOrDone.length === 0) {
    // No heading over an empty list: somebody who has never queued a large
    // export has nothing to collect and does not need to be told so.
    return null;
  }

  return (
    <section className="flex flex-col gap-1.5" data-testid="my-exports">
      <h2 className="text-xs font-medium text-ink-3">Your exports</h2>
      <ul className="flex flex-col gap-1">
        {queuedOrDone.map((run) => (
          <li
            key={run.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-ink-3"
          >
            <span className="text-ink-2">{run.filename}</span>
            <span>
              {run.rowCount === null
                ? STATE_TEXT[run.state]
                : `${STATE_TEXT[run.state]}, ${run.rowCount} ${
                    run.rowCount === 1 ? "row" : "rows"
                  }`}
            </span>
            {run.state === "ready" && run.blobId ? (
              <a
                href={`/api/exports/${run.id}/download`}
                className="text-brand hover:underline"
              >
                Download
              </a>
            ) : null}
            {run.error ? (
              // The worker's own sentence, not a status code. A member who
              // reads "you are no longer active in this workspace" knows what
              // happened; "failed" tells them to ask somebody.
              <span className="text-bad">{run.error}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
