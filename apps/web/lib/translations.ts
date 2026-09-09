import { CATALOGUES, translate } from "@openokr/ui";
import { resolveLocale } from "./locale";

/**
 * The catalogue, for a server component (UIUX-PLAN §8, P6-G25).
 *
 * **P6-G22b shipped a gate that a server component could not satisfy, and this
 * is the missing half.** `useTranslations` is a client hook and
 * `TranslationsProvider` is a client provider, so every route in this
 * application, all of which are server components, had no `t()` to call. The
 * gate said "a new hardcoded string fails the build" and the only ways to obey
 * it were to move text into a client component that does not need to exist, or
 * to add a line to the exemption list. That ordering was wrong in the split,
 * and P6-G25 is the row that met it first.
 *
 * **Not a provider, because a server component has no context.** It reads the
 * locale the same way the root layout does and returns the one function a page
 * needs. `translate` still raises on a missing key rather than fabricating a
 * fallback, which is the catalogue's own rule and is what makes the pseudo
 * locale a build check rather than a suggestion.
 *
 * The catalogue holds seven keys plus whatever a task adds as it goes. Moving
 * the remaining strings is P6-G22c; what this makes possible is that a *new*
 * screen no longer has to add to the debt.
 */
export async function getTranslations(): Promise<{
  readonly t: (key: string) => string;
}> {
  const locale = await resolveLocale();
  const catalogue = CATALOGUES[locale];
  return { t: (key: string) => translate(catalogue, key) };
}
