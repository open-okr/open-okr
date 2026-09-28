"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn.ts";

/**
 * The More tab and the sheet it opens (completeness review H-16). The links
 * arrive already drawn, so the router's link component never crosses into
 * the client. The sheet closes on a choice, on Escape and on a tap outside it,
 * and Escape hands focus back to the tab that opened it.
 */
export function MobileMore({
  label,
  icon,
  className,
  active,
  children,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly className: string;
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    sheet.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !sheet.current?.contains(target) &&
        !toggle.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <>
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => setOpen((value) => !value)}
        className={cn(className, (open || active) && "text-brand-text")}
      >
        <span className="size-5" aria-hidden="true">
          {icon}
        </span>
        {label}
      </button>
      {/* Hidden rather than unmounted, so aria-controls always names an
       * element that exists. A choice closes it by delegation: any link
       * inside is a navigation. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the click is delegated from the links inside, which are the interactive elements */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: each link inside handles its own keyboard activation, which fires this same click */}
      <div
        ref={sheet}
        id={sheetId}
        hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) {
            setOpen(false);
          }
        }}
        className="fixed inset-x-0 bottom-14 max-h-[70vh] overflow-y-auto border-t border-line bg-surface px-4 py-3 shadow-lg"
      >
        {children}
      </div>
    </>
  );
}
