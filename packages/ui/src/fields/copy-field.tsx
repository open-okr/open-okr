"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../components/tooltip.tsx";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { TextInput } from "./text-input.tsx";

const COPIED_FOR_MS = 2_000;

/**
 * A read-only value with a copy icon attached at its end, drawn as one
 * bordered control (an input group). The border and the focus ring belong to
 * the group, so the field and the button read as a single control.
 *
 * `copyLabel` names the icon button for assistive technology and for the
 * tooltip. It is passed in because what is being copied is page-specific.
 *
 * It does not reuse `CopyButton`: that component wraps its button in spans
 * and draws a visible status, which cannot fill the group's height. Here
 * "Copied" is announced to screen readers and shown as a check icon. When the
 * clipboard is refused the value is selected for Ctrl/Cmd+C and a line below
 * the group says so.
 */
export function CopyField({
  label,
  copyLabel,
  value,
  className,
  monospace = true,
}: {
  /** Names the read-only field. Not drawn. */
  readonly label: string;
  readonly copyLabel: string;
  readonly value: string;
  readonly className?: string;
  readonly monospace?: boolean;
}) {
  const { t } = useTranslations();
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");
  const groupRef = useRef<HTMLDivElement>(null);

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
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("refused");
      groupRef.current?.querySelector("input")?.select();
    }
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        ref={groupRef}
        className="flex h-7.5 items-stretch overflow-hidden rounded-control border border-line-2 bg-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line"
      >
        <TextInput
          className="min-w-0 flex-1"
          // The group's inner height is the field's height less its border.
          inputClassName={cn(
            "h-7 rounded-none border-0 bg-transparent focus:border-0 focus:ring-0",
            monospace ? "font-mono" : null,
          )}
          label={label}
          hideLabel
          readOnly
          value={value}
        />
        <Tooltip label={copyLabel}>
          <button
            type="button"
            aria-label={copyLabel}
            onClick={copy}
            className="flex w-7.5 shrink-0 items-center justify-center border-l border-line-2 text-ink-3 hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:outline-none"
          >
            {state === "copied" ? (
              <Check aria-hidden="true" className="size-3.5 text-ok" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
          </button>
        </Tooltip>
        <span role="status" className="sr-only">
          {state === "copied" ? t("copy.copied") : ""}
        </span>
      </div>
      {state === "refused" ? (
        <p role="alert" className="text-xs text-bad">
          {t("copy.failed")}
        </p>
      ) : null}
    </div>
  );
}
