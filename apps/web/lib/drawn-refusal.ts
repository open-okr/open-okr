/**
 * The sentence a client form says over its fields after a refused save
 * (guided-inputs §4.2, plan U1b): none when a field it draws already shows
 * the message, so nothing is said twice; the action's sentence otherwise.
 *
 * For an action several screens call, which keeps its sentence beside the
 * fields because not every caller draws them (the OKR editor's adds). Pure,
 * and imports nothing, so a client component can use it without pulling
 * `@openokr/core` into the browser the way `lib/refusal.ts` would.
 */
export function sentenceUnlessDrawn(
  result: {
    readonly error: string | null;
    readonly fields?: Readonly<Record<string, string>>;
  },
  drawn: readonly string[],
): string | null {
  const fields = result.fields ?? {};
  return drawn.some((name) => fields[name] !== undefined) ? null : result.error;
}
