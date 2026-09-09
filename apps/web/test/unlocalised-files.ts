/**
 * Every file whose user-facing strings are still hardcoded (P6-G22b).
 *
 * **The list is empty, and that is the finished state** (P6-G22c). It held 146
 * files and 1,543 strings between them when P6-G22b wrote it down as a debt
 * that only ever shrinks. Every one of them is in the catalogue now, so there
 * is nothing left to excuse.
 *
 * **The array stays, and so do its three rules**, all enforced by
 * `catalogue-coverage.test.ts`: a file not on this list must have no hardcoded
 * string, a name on this list must be a file that exists, and a file on this
 * list must still have at least one. With the list empty the first rule covers
 * every route in the application and the other two have nothing to say, which
 * is exactly what an emptied debt looks like.
 *
 * **Adding a line here is a decision somebody has to make on purpose**, and
 * now it is also a regression. The reason the list existed at all was that
 * `useTranslations` is a client hook, so a server component had no `t()` to
 * call; P6-G25 built `getTranslations()` and removed that excuse.
 */
export const UNLOCALISED_FILES: readonly string[] = [];
