"use client";

import { isEmailAddress } from "@openokr/formats";
import { useTranslations } from "../i18n/use-translations.tsx";
import { TextInput, type TextInputProps } from "./text-input.tsx";

/**
 * An email address, checked with the server's own rule (§4.4).
 *
 * The browser's `type="email"` accepts `priya@northwind`, which the server
 * refuses, so the field checks with `isEmailAddress` from `packages/formats`
 * and keeps the type only for the keyboard a phone opens.
 *
 * **Surrounding spaces are taken off when the person leaves the field.** A
 * phone's autocomplete adds one after the address, and Better Auth's sign-up
 * schema does not trim, so an address that looked right was refused.
 */
export function EmailInput({
  autoComplete = "email",
  onBlur,
  ...props
}: Omit<TextInputProps, "type" | "check" | "inputMode">) {
  const { t } = useTranslations();
  return (
    <TextInput
      {...props}
      onBlur={(event) => {
        const control = event.currentTarget;
        const trimmed = control.value.trim();
        if (trimmed !== control.value) {
          control.value = trimmed;
        }
        onBlur?.(event);
      }}
      type="email"
      inputMode="email"
      autoComplete={autoComplete}
      autoCapitalize="none"
      spellCheck={false}
      check={(value) => {
        const address = value.trim();
        return address === "" || isEmailAddress(address)
          ? null
          : t("fields.email.invalid");
      }}
    />
  );
}
