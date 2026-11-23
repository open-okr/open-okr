import { callAction } from "@openokr/core";
import { isShippedLocale } from "@openokr/formats";
import { cookies } from "next/headers";
import {
  VISITOR_LANGUAGE_CHOSEN_COOKIE,
  VISITOR_LANGUAGE_COOKIE,
} from "./locale";
import { getPool } from "./pool";
import { requireWorkspace } from "./workspace";

/**
 * Called right after a successful sign-in. A language picked on the sign-in
 * page becomes the member's language, because a member's stored language wins
 * once signed in and the pick would otherwise be ignored. A language must
 * never block a sign-in, so every failure is swallowed.
 */
export async function applyChosenLanguage(): Promise<void> {
  try {
    const jar = await cookies();
    if (!jar.get(VISITOR_LANGUAGE_CHOSEN_COOKIE)) {
      return;
    }
    const language = jar.get(VISITOR_LANGUAGE_COOKIE)?.value;
    if (isShippedLocale(language)) {
      const { session, workspace } = await requireWorkspace();
      await callAction(
        {
          pool: getPool(),
          workspaceId: workspace.workspaceId,
          actor: { kind: "human", userId: session.user.id },
        },
        "people.updateOwnProfile",
        { language },
      );
    }
  } catch {
    // Intentionally ignored, see above.
  }
  try {
    (await cookies()).delete(VISITOR_LANGUAGE_CHOSEN_COOKIE);
  } catch {
    // Cookies cannot be written in some render contexts.
  }
}
