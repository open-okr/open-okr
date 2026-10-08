"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { TextInput, type TextInputProps } from "./text-input.tsx";

/**
 * A password, a passphrase or a key, with a reveal toggle (§4.11).
 *
 * The toggle flips `type` between `password` and `text` rather than drawing
 * another input, so the value, the caret and the password manager's binding
 * all survive it. It is a real button with one name and `aria-pressed` for
 * its state, because a name that changes with the state says the state twice
 * to a screen reader. Somebody typing a long passphrase on a phone is exactly
 * who needs to check what they typed.
 */
export function SecretInput({
  id,
  ...props
}: Omit<TextInputProps, "type" | "trailing" | "check">) {
  const { t } = useTranslations();
  const [revealed, setRevealed] = useState(false);
  const generated = useId();
  const controlId = id ?? generated;

  return (
    <TextInput
      {...props}
      id={controlId}
      type={revealed ? "text" : "password"}
      spellCheck={false}
      autoCapitalize="none"
      trailing={
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          aria-pressed={revealed}
          aria-controls={controlId}
          aria-label={t("fields.secret.showWhatYouTyped")}
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-control text-ink-3 outline-none hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-brand-line"
        >
          {revealed ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      }
    />
  );
}
