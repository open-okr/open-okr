"use client";

/**
 * What every error page does besides apologising (docs/design/
 * error-reporting.md D16, D21, plan 0.7.0 E3).
 *
 * It reports a client-side error once, and it offers "Copy details": the
 * version, the reference, the time and the route pattern, as plain text for
 * a bug report. A self-hosted instance never reports to the project, because
 * nothing phones home, so this is how the project hears about an error: a
 * person chooses to tell it. Nothing in the text names the person, the
 * workspace or the address they were on.
 */
import { Button, useTranslations } from "@openokr/ui";
import { useEffect, useState } from "react";
import { RUNNING_VERSION } from "./app-version";
import { reportClientError, useRoutePattern } from "./client-error-reporter";

/**
 * The text "Copy details" copies. Its labels are fixed rather than
 * translated: it is pasted into the project's bug template, which reads them.
 */
export function errorDetailsText(details: {
  readonly version: string;
  readonly digest: string | undefined;
  readonly time: string;
  readonly route: string | null;
}): string {
  return [
    `OpenOKR ${details.version}`,
    `Reference: ${details.digest ?? "none"}`,
    `Time: ${details.time}`,
    `Page: ${details.route ?? "unknown"}`,
  ].join("\n");
}

/**
 * Reports a boundary's error once, and builds its details. An error with a
 * digest came from the server, which has reported it already.
 */
function useErrorDetails(error: Error & { digest?: string }): string {
  const route = useRoutePattern();
  const [time] = useState(() => new Date().toISOString());
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);
  return errorDetailsText({
    version: RUNNING_VERSION,
    digest: error.digest,
    time,
    route,
  });
}

type CopyState = "idle" | "copied" | "failed";

function useCopy(text: string): [CopyState, () => void] {
  const [copied, setCopied] = useState<CopyState>("idle");
  const copy = () => {
    // A page served over plain http has no clipboard; the text is then shown
    // so it can be copied by hand.
    if (!navigator.clipboard) {
      setCopied("failed");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setCopied("copied"),
      () => setCopied("failed"),
    );
  };
  return [copied, copy];
}

/** "Copy details", on the kit's button, for a boundary inside the layout. */
export function CopyErrorDetails({
  error,
}: {
  readonly error: Error & { digest?: string };
}) {
  const { t } = useTranslations();
  const text = useErrorDetails(error);
  const [copied, copy] = useCopy(text);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="sm" onClick={copy}>
        {copied === "copied"
          ? t("errorDetails.copied")
          : t("errorDetails.copy")}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied === "copied" ? t("errorDetails.copied") : ""}
      </span>
      {copied === "failed" ? (
        <>
          <p className="text-xs text-ink-3">{t("errorDetails.copyByHand")}</p>
          <pre className="whitespace-pre-wrap text-xs text-ink-3">{text}</pre>
        </>
      ) : null}
    </div>
  );
}

/**
 * The same for the last boundary, which replaces the root layout and so
 * cannot count on the stylesheet: inline styles, like the rest of that page.
 */
export function PlainCopyErrorDetails({
  error,
}: {
  readonly error: Error & { digest?: string };
}) {
  const { t } = useTranslations();
  const text = useErrorDetails(error);
  const [copied, copy] = useCopy(text);
  return (
    <div style={{ margin: "1rem 0 0" }}>
      <button
        type="button"
        onClick={copy}
        style={{
          fontSize: "0.75rem",
          padding: "0.375rem 0.625rem",
          borderRadius: "0.375rem",
          border: "1px solid #dbe2ec",
          background: "#ffffff",
          color: "#1a2332",
          cursor: "pointer",
        }}
      >
        {copied === "copied"
          ? t("errorDetails.copied")
          : t("errorDetails.copy")}
      </button>
      <span
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        {copied === "copied" ? t("errorDetails.copied") : ""}
      </span>
      {copied === "failed" ? (
        <pre
          style={{
            fontSize: "0.75rem",
            whiteSpace: "pre-wrap",
            color: "#5c6b80",
          }}
        >
          {text}
        </pre>
      ) : null}
    </div>
  );
}
