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
 * How long a press may be answered before its spinner appears. The same wait
 * as `ACTIVITY_DELAY_MS` in `apps/web/lib/activity-indicator.tsx` and as
 * UIUX-PLAN §4 "Acting": a save that answers faster needs no spinner, and one
 * that flashes for a frame reads as a glitch. The button refuses a press at once
 * either way, so a second press is refused from the first moment.
 */
const PENDING_SPINNER_DELAY_MS = 200;

/** True once `active` has stayed true for the spinner's wait. */
export function useDelayedFlag(active: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), PENDING_SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active]);
  // `active &&` so the frame after a send ends never paints a stale spinner:
  // the reset above runs in an effect, after paint.
  return active && shown;
}

/**
 * A press that is already being answered is refused here, not with `disabled`.
 * A focused button that becomes `disabled` loses focus to the page, and a
 * keyboard or screen-reader user who pressed Save is dropped at the top of the
 * document. `aria-disabled` keeps focus, and the guard stops a second press.
 */
export function guardPress(
  refusing: boolean,
  onClick: ButtonHTMLAttributes<HTMLButtonElement>["onClick"],
): ButtonHTMLAttributes<HTMLButtonElement>["onClick"] {
  return (event) => {
    if (refusing) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
}

/**
 * Whether the form this submit button belongs to is being sent, and whether
 * it was this button that sent it.
 *
 * `useFormStatus` says a form is pending but not who pressed it. The submit
 * event names the pressed button (`submitter`) and fires before React starts
 * the action, so `pressed` is settled by the time the form turns pending.
 * That keeps the spinner on Save and not on Reset beside it. `submitter` is
 * null only when the form was sent with `requestSubmit()` and no argument,
 * which is a send nobody can attribute, so every submit button of the form
 * spins. Enter in a field clicks the form's default button, so it names one.
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
   * "Acting"): refused at once, so a second press cannot send it twice, and
   * a spinner before the label after 200 milliseconds. A submit button
   * inside a form with a function action gets this on its own; pass it for
   * any other write.
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
      onClick,
      children,
      ...props
    },
    forwarded,
  ) => {
    const { ref, sending, spinning } = useSubmitPending(type, forwarded);
    const busy = Boolean(pending || spinning);
    // Refused, not disabled, while the server answers: see `guardPress`. A
    // caller's own `disabled` is ignored for that time, since it may be
    // `disabled={pending}` and would take the focus away again.
    const refusing = Boolean(pending || sending);
    const showSpinner = useDelayedFlag(busy);
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={refusing ? undefined : disabled}
        aria-disabled={refusing || undefined}
        aria-busy={busy || undefined}
        onClick={guardPress(refusing, onClick)}
        {...props}
      >
        {showSpinner ? (
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
