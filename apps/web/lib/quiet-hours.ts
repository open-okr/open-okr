/**
 * The quiet-hours pair a form submitted, read the same way on the profile
 * (S-33) and on the member's channel settings (S-36).
 *
 * **Both times or neither.** Two empty times turn quiet hours off. One time
 * alone is refused rather than read as "off": the profile form posted two
 * boxes it had never filled with the saved window, so saving a new timezone
 * deleted the member's quiet hours, and nudges reached them at night. A form
 * that does not carry the pair at all leaves the window as it is.
 */
export type QuietHoursField =
  | {
      readonly ok: true;
      /** Absent when the form sent neither field: leave the window alone. */
      readonly value?: { readonly start: string; readonly end: string } | null;
    }
  | { readonly ok: false };

export function quietHoursFromForm(form: FormData): QuietHoursField {
  const start = form.get("quietStart");
  const end = form.get("quietEnd");
  if (start === null && end === null) {
    return { ok: true };
  }
  const from = typeof start === "string" ? start.trim() : "";
  const to = typeof end === "string" ? end.trim() : "";
  if (from === "" && to === "") {
    return { ok: true, value: null };
  }
  if (from === "" || to === "") {
    return { ok: false };
  }
  return { ok: true, value: { start: from, end: to } };
}
