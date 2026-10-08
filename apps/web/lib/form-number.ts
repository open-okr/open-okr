/**
 * A number typed into a form field, or NaN when nothing usable was typed.
 *
 * `Number("")` is 0, so a field left empty, or a browser check bypassed,
 * passed every `Number.isFinite` guard and was saved as a zero nobody
 * entered (UAT BUG-003). Empty and whitespace now read as missing, which the
 * guard after it already refuses with its own sentence.
 */
export function formNumber(form: FormData, name: string): number {
  const raw = form.get(name);
  if (typeof raw !== "string" || raw.trim() === "") {
    return Number.NaN;
  }
  return Number(raw);
}
