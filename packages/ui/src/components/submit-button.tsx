"use client";

import { LoaderCircle } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../lib/cn.ts";
import {
  Button,
  type ButtonProps,
  guardPress,
  useDelayedFlag,
  useSubmitPending,
} from "./button.tsx";

type SubmitButtonProps = Omit<ButtonProps, "type" | "pending"> & {
  /**
   * Keep the caller's own classes and add only the pending behaviour. For
   * the submit buttons that predate the kit's `Button`, so giving them the
   * spinner does not also restyle them.
   */
  readonly bare?: boolean;
};

/**
 * The bare mode: the caller's classes, with the same pending behaviour as
 * `Button`. A component of its own because a hook cannot be called in only
 * one branch of `SubmitButton`.
 */
const BareSubmitButton = forwardRef<
  HTMLButtonElement,
  Omit<SubmitButtonProps, "bare" | "variant" | "size">
>(({ className, disabled, onClick, children, ...props }, forwarded) => {
  const { ref, sending, spinning } = useSubmitPending("submit", forwarded);
  const showSpinner = useDelayedFlag(spinning);
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5",
        className,
      )}
      disabled={sending ? undefined : disabled}
      aria-disabled={sending || undefined}
      aria-busy={spinning || undefined}
      onClick={guardPress(sending, onClick)}
      {...props}
      // After the spread: a Base UI part that renders this button merges in
      // its own `type="button"`, and the avatar menu's Sign out (Q-10a) then
      // stopped submitting its form.
      type="submit"
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
});
BareSubmitButton.displayName = "BareSubmitButton";

/**
 * A form's submit button that knows the form is being sent (UIUX-PLAN §4,
 * "Acting"). React's `useFormStatus` reads the form it sits in, so the button
 * works inside a form a server component drew: the Cycle and Spaces forms
 * pass their markup through a client wrapper, and their Save had no way to
 * say it had been pressed (owner, 4 November 2026).
 *
 * `Button` now does this for any `type="submit"`, so this stays for the
 * `bare` mode and for the call sites that already use it.
 */
export const SubmitButton = forwardRef<HTMLButtonElement, SubmitButtonProps>(
  ({ bare, variant, size, ...props }, forwarded) =>
    bare ? (
      <BareSubmitButton ref={forwarded} {...props} />
    ) : (
      <Button
        ref={forwarded}
        type="submit"
        variant={variant}
        size={size}
        {...props}
      />
    ),
);
SubmitButton.displayName = "SubmitButton";
