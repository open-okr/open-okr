import {
  isValidRichText,
  parseRichText,
  RICH_TEXT_SCHEMA_VERSION,
  type RichTextDocument,
} from "@openokr/core";
import { isBlankDocument } from "@openokr/ui";

/** What a form's rich text field held when it was posted. */
export type RichTextFieldValue =
  | { readonly state: "absent" }
  | { readonly state: "blank" }
  | { readonly state: "malformed" }
  | { readonly state: "document"; readonly document: RichTextDocument };

/**
 * A rich text field from a posted form (docs/design/guided-inputs.md §4.7).
 *
 * `RichTextField` writes its document into a hidden input only once it is
 * edited, so the four answers are different instructions: **absent** is
 * "leave it as it is", **blank** is an editor emptied by hand, **malformed**
 * is a client that sent something no editor makes, and **document** is the
 * text, with its formatting, validated against the same schema the action
 * holds it to.
 */
export function readRichTextField(
  form: FormData,
  name: string,
): RichTextFieldValue {
  const raw = form.get(name);
  if (typeof raw !== "string") {
    return { state: "absent" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "malformed" };
  }
  if (!isValidRichText(parsed, RICH_TEXT_SCHEMA_VERSION)) {
    return { state: "malformed" };
  }
  if (isBlankDocument(parsed)) {
    return { state: "blank" };
  }
  return {
    state: "document",
    document: parseRichText(parsed, RICH_TEXT_SCHEMA_VERSION),
  };
}

/**
 * A rich text field from a form that writes every field on each save, the
 * cycle's forms among them (`RichTextField`'s `sendUnchanged`): the document,
 * null for an empty field, or "malformed" for something no editor makes.
 */
export function documentOrNull(
  form: FormData,
  name: string,
): RichTextDocument | null | "malformed" {
  const read = readRichTextField(form, name);
  if (read.state === "malformed") {
    return "malformed";
  }
  return read.state === "document" ? read.document : null;
}
