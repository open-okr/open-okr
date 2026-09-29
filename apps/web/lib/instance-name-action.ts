"use server";

/**
 * The instance's name, for the one page that cannot be handed it (completeness
 * review M-33).
 *
 * `global-error.tsx` replaces the root layout rather than sitting inside it,
 * so the provider that gives every other client component the name is the
 * thing that failed. It asks here once it has rendered, and says "OpenOKR"
 * until then or if this fails too. Nothing is given away by answering: the
 * name is on the sign-in page and in every tab title already.
 */
import { getInstanceName } from "./instance-name";

export async function instanceNameForErrorPage(): Promise<string> {
  return getInstanceName();
}
