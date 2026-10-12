"use client";

import { IDENTIFIER_MAX_LENGTH, isOneWord, isSlug } from "@openokr/formats";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { TextInput, type TextInputProps } from "./text-input.tsx";

/**
 * An identifier copied from another system or made up for one (§4.11): a
 * channel id, a model id, a provider id. Monospace, so `l` and `1` differ,
 * with no spellcheck or capitals a phone would add, and the server's rule
 * applied while typing.
 *
 * A rule is named rather than passed, so a server page can draw the field:
 *
 * | Rule | Takes | Used for |
 * |---|---|---|
 * | `word` | One word, no spaces | Channel ids, a model id |
 * | `slug` | Lowercase letters, numbers and hyphens. Capitals are lowered as typed | A single sign-on provider id |
 *
 * Anything else stays where it was typed and is marked, rather than dropped:
 * a keystroke that vanished would be a rule the person has to guess.
 */
export function IdentifierInput({
  rule = "word",
  maxLength = IDENTIFIER_MAX_LENGTH,
  inputClassName,
  onBlur,
  onChange,
  ...props
}: Omit<TextInputProps, "check" | "type"> & {
  readonly rule?: "word" | "slug";
}) {
  const { t } = useTranslations();
  return (
    <TextInput
      {...props}
      maxLength={maxLength}
      onChange={(event) => {
        const control = event.currentTarget;
        if (rule === "slug") {
          const lower = control.value.toLowerCase();
          if (lower !== control.value) {
            // Same length, so the caret stays where it was.
            const { selectionStart, selectionEnd } = control;
            control.value = lower;
            control.setSelectionRange(selectionStart, selectionEnd);
          }
        }
        onChange?.(event);
      }}
      onBlur={(event) => {
        const control = event.currentTarget;
        const trimmed = control.value.trim();
        if (trimmed !== control.value) {
          control.value = trimmed;
        }
        onBlur?.(event);
      }}
      autoCapitalize="none"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      inputClassName={cn("font-mono", inputClassName)}
      check={(value) => {
        // Judged as it will be sent: trimmed, and lowered for a slug, since
        // the field lowers it the moment this check has run.
        const id = value.trim();
        if (id === "") {
          return null;
        }
        if (rule === "slug") {
          return isSlug(id.toLowerCase()) ? null : t("fields.identifier.slug");
        }
        return isOneWord(id) ? null : t("fields.identifier.oneWord");
      }}
    />
  );
}
