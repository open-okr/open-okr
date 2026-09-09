"use server";

/**
 * A member's theme and density, stored on the member (P6-G23).
 *
 * The theme provider has exposed `setTheme` and `setDensity` since P2-T10 and
 * nothing has ever called them, so both lived in `localStorage` only: a
 * property of a browser rather than of a person. Signing in on a second
 * machine, or in a private window, put a member back on the default.
 *
 * The control writes both here and to the provider. The provider is what makes
 * the change immediate and what the pre-hydration script reads on the next
 * load; this is what makes it follow the member to another machine.
 */

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "./pool";
import { requireWorkspace } from "./workspace";

export async function setAppearance(input: {
  theme?: "light" | "dark" | "system";
  density?: "comfortable" | "compact";
  /** Which catalogue renders for this member (P6-G22a). */
  language?: "en" | "ms";
}): Promise<{ error: string | null }> {
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "people.updateOwnProfile",
      input,
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  // **The theme and the density need no revalidation and the language does.**
  // The provider has already applied a theme change in the browser, so
  // re-rendering the tree would repaint every page to arrive at what the
  // reader is already looking at. A language is not like that: the text is
  // rendered on the server, so the screen does not change until the server
  // renders it again (P6-G22a).
  if (input.language !== undefined) {
    revalidatePath("/", "layout");
  }
  return { error: null };
}
