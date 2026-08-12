"use client";

import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, useId, useState } from "react";
import { fieldInputClass } from "./auth-card.tsx";

/**
 * A password field with a reveal toggle.
 *
 * The toggle flips `type` between `password` and `text` rather than
 * re-rendering a different input, so the value, the caret and the browser's
 * password manager binding all survive the switch.
 *
 * The button is a real focusable control, not an icon the mouse alone can
 * reach: someone typing a long passphrase on a phone keyboard is exactly who
 * needs to check what they typed. `aria-pressed` carries the state, and the
 * icons are hidden from assistive technology because the label already says
 * what the button does.
 */
export function PasswordField({
  label,
  ...input
}: {
  label: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const [revealed, setRevealed] = useState(false);
  // `useId` rather than the name, because a page can hold two password fields
  // (current and new) and duplicate ids break the label association.
  const generated = useId();
  const id = input.id ?? `field-${input.name ?? generated}`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          {...input}
          type={revealed ? "text" : "password"}
          className={`${fieldInputClass} pr-8`}
        />
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          aria-pressed={revealed}
          aria-controls={id}
          aria-label={revealed ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-lg text-ink-3 outline-none hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-brand-line"
        >
          {revealed ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
