"use client";

import { TextInput, type TextInputProps } from "./text-input.tsx";

/**
 * A search box (docs/design/guided-inputs.md §4.11): `type="search"`, so a
 * phone's keyboard offers Search and the browser offers a clear button, a
 * label like every other field, and the server's limit as `maxLength`.
 *
 * Nothing is remembered between searches, because what somebody looked for
 * last week is not a suggestion for this one.
 */
export function SearchInput({
  autoComplete = "off",
  ...props
}: Omit<TextInputProps, "type" | "inputMode">) {
  return (
    <TextInput
      {...props}
      type="search"
      inputMode="search"
      enterKeyHint="search"
      autoComplete={autoComplete}
    />
  );
}
