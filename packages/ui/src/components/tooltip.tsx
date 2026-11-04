"use client";

import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import { isValidElement, type ReactElement } from "react";

/**
 * The name of an icon-only control, shown on hover and on keyboard focus.
 *
 * An icon says what it does only to somebody who already knows. The Goals
 * list's ✓, ↗ and ⋯ had an accessible name and nothing a sighted person
 * could read, and the browser's own `title` arrives late and never on focus
 * (owner review, 2 November 2026). The control keeps its `aria-label`; this
 * repeats it where it can be seen.
 *
 * The child is the trigger itself, so a button, a link or another Base UI
 * trigger (a menu's) keeps its own element and behaviour.
 */
export function Tooltip({
  label,
  children,
  side = "top",
}: {
  readonly label: string;
  /** One element that takes a ref: a button, a link, a Base UI trigger. */
  readonly children: ReactElement<Record<string, unknown>>;
  readonly side?: "top" | "bottom" | "left" | "right";
}) {
  // A server component's child arrives here as a lazy reference rather than an
  // element, and Base UI's `render` clones it into an element with no type,
  // which took the whole Home page down (4 November 2026). Such a child is
  // drawn inside a span trigger instead of being cloned.
  const trigger = isValidElement(children) ? (
    <BaseTooltip.Trigger render={children} delay={250} />
  ) : (
    <BaseTooltip.Trigger render={<span className="inline-flex" />} delay={250}>
      {children}
    </BaseTooltip.Trigger>
  );
  return (
    <BaseTooltip.Root>
      {trigger}
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="max-w-64 rounded-md bg-ink px-2 py-1 text-[11.5px] leading-snug font-medium text-surface shadow-(--shadow-popover)">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
