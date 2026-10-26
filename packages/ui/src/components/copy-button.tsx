"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { Button, type ButtonProps } from "./button.tsx";

const COPIED_FOR_MS = 2_000;

/**
 * A button that puts text on the clipboard
 * (docs/design/agent-setup-prompt.md §5).
 *
 * **The refused path is real.** `navigator.clipboard` exists only in a secure
 * context, and a self-hosted instance reached over plain HTTP on a LAN address
 * is not one. So a refusal is announced and the text is shown, selected, for
 * copying by hand, rather than the button silently doing nothing.
 *
 * **The label never changes.** "Copied" is announced in a status region beside
 * the button, so the button keeps one accessible name and a screen reader hears
 * the outcome once.
 */
export function CopyButton({
  text,
  children,
  className,
  variant,
  size,
  ...props
}: {
  readonly text: string;
  readonly children: ReactNode;
} & Omit<ButtonProps, "onClick" | "children">) {
  const { t } = useTranslations();
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");

  useEffect(() => {
    if (state !== "copied") {
      return;
    }
    const timer = setTimeout(() => setState("idle"), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error("No clipboard in this context");
      }
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("refused");
    }
  };

  return (
    <span className="inline-flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-2">
        <Button
          {...props}
          variant={variant}
          size={size}
          className={className}
          onClick={copy}
        >
          {children}
        </Button>
        <span role="status" className="text-xs text-ok">
          {state === "copied" ? t("copy.copied") : ""}
        </span>
      </span>
      {state === "refused" ? (
        <span className="flex flex-col gap-1">
          <span role="alert" className="text-xs text-bad">
            {t("copy.failed")}
          </span>
          <textarea
            aria-label={t("copy.manualLabel")}
            readOnly
            value={text}
            rows={6}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full min-w-72 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-ink"
          />
        </span>
      ) : null}
    </span>
  );
}
