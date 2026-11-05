"use client";

import type { VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useFormStatus } from "react-dom";
import { cn } from "../lib/cn.ts";
import { buttonVariants } from "./button-variants.ts";

/**
 * Whether the form this submit button belongs to is being sent, and whether
 * it was this button that sent it.
 *
 * `useFormStatus` says a form is pending but not who pressed it. The submit
 * event names the pressed button (`submitter`) and fires before React starts
 * the action, so `pressed` is settled by the time the form turns pending.
 * That keeps the spinner on Save and not on Reset beside it. `submitter` is
 * null when Enter was pressed in a field with no default button, which is a
 * send nobody can attribute, so every submit button of the form spins.
 *
 * `useFormStatus` only turns pending for a form whose `action` is a function.
 * A form that handles `onSubmit` itself and calls `preventDefault` never does,
 * and a button there passes `pending` instead.
 */
export function useSubmitPending(
  type: ButtonHTMLAttributes<HTMLButtonElement>["type"],
  forwarded: ForwardedRef<HTMLButtonElement>,
) {
  const own = useRef<HTMLButtonElement | null>(null);
  const { pending: formPending } = useFormStatus();
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const form = own.current?.form;
    if (type !== "submit" || !form) {
      return;
    }
    const onSubmit = (event: SubmitEvent) =>
      setPressed(event.submitter === own.current || event.submitter === null);
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [type]);

  const ref = useCallback(
    (node: HTMLButtonElement | null) => {
      own.current = node;
      if (typeof forwarded === "function") {
        forwarded(node);
      } else if (forwarded) {
        forwarded.current = node;
      }
    },
    [forwarded],
  );

  const sending = type === "submit" && formPending;
  return { ref, sending, spinning: sending && pressed };
}

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * The server is working on what this button started (UIUX-PLAN §4,
   * "Acting"): a spinner before the label, and disabled, so a second press
   * cannot send it twice. A submit button inside a form with a function
   * action gets this on its own; pass it for any other write.
   */
  readonly pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      type = "button",
      pending,
      disabled,
      children,
      ...props
    },
    forwarded,
  ) => {
    const { ref, sending, spinning } = useSubmitPending(type, forwarded);
    const busy = pending || spinning;
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || pending || sending}
        aria-busy={busy || undefined}
        {...props}
      >
        {busy ? (
          <LoaderCircle
            aria-hidden="true"
            data-testid="button-pending"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
