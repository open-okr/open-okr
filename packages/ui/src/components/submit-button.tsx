"use client";

import { LoaderCircle } from "lucide-react";
import { forwardRef } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "../lib/cn.ts";
import { Button, type ButtonProps } from "./button.tsx";

/**
 * A form's submit button that knows the form is being sent (UIUX-PLAN §4,
 * "Acting"). React's `useFormStatus` reads the form it sits in, so the button
 * works inside a form a server component drew: the Cycle and Spaces forms
 * pass their markup through a client wrapper, and their Save had no way to
 * say it had been pressed (owner, 4 November 2026).
 */
export const SubmitButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "type" | "pending"> & {
    /**
     * Keep the caller's own classes and add only the pending behaviour. For
     * the submit buttons that predate the kit's `Button`, so giving them the
     * spinner does not also restyle them.
     */
    readonly bare?: boolean;
  }
>(({ bare, className, variant, size, disabled, children, ...props }, ref) => {
  const { pending } = useFormStatus();
  if (!bare) {
    return (
      <Button
        ref={ref}
        type="submit"
        pending={pending}
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        {...props}
      >
        {children}
      </Button>
    );
  }
  return (
    <button
      ref={ref}
      type="submit"
      className={cn(
        "inline-flex items-center justify-center gap-1.5",
        className,
      )}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? (
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
SubmitButton.displayName = "SubmitButton";
