"use client";

import { isWebUrl } from "@openokr/formats";
import { useTranslations } from "../i18n/use-translations.tsx";
import { TextInput, type TextInputProps } from "./text-input.tsx";

/**
 * A web address, checked with the server's own rule (§4.11).
 *
 * The browser's `type="url"` takes `ftp://` and `javascript:`, so the field
 * checks with `isWebUrl` from `packages/formats` and keeps the type for the
 * keyboard a phone opens. `secure` is for an address the server takes only on
 * https, such as an OpenID provider's endpoints.
 *
 * Surrounding spaces are taken off when the person leaves the field, as the
 * email field does, because a pasted address often brings one.
 */
export function UrlInput({
  secure = false,
  onBlur,
  ...props
}: Omit<TextInputProps, "type" | "check" | "inputMode"> & {
  readonly secure?: boolean;
}) {
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
      type="url"
      inputMode="url"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      check={(value) => {
        const address = value.trim();
        if (address === "" || isWebUrl(address, { secure })) {
          return null;
        }
        return secure ? t("fields.url.notSecure") : t("fields.url.invalid");
      }}
    />
  );
}
