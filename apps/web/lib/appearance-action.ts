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
import { getPool } from "./pool";
import { requireWorkspace } from "./workspace";

export async function setAppearance(input: {
  theme?: "light" | "dark" | "system";
  density?: "comfortable" | "compact";
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
  // Deliberately no `revalidatePath`. The provider has already applied the
  // change in the browser, and re-rendering the tree would repaint every page
  // to arrive at what the reader is already looking at.
  return { error: null };
}
