import type { Membership } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE } from "../lib/workspace";

/**
 * The workspace switcher (UIUX-PLAN §5, the sidebar).
 *
 * Behaviour only. The design system, the sidebar it belongs in and its visual
 * treatment arrive with P2-T10, which is recorded on that row.
 *
 * It renders nothing for somebody who belongs to one workspace, which is every
 * self-hosted instance until invitations land. A control that only ever shows
 * one option is noise.
 */

/**
 * Remembers the chosen workspace.
 *
 * A cookie can only be set from a Server Function or a Route Handler, never
 * during a render, so the switch is a form submission rather than a link. It
 * also means the choice survives without a column: the request re-derives
 * everything from the membership list either way.
 */
async function switchWorkspace(formData: FormData): Promise<void> {
  "use server";

  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (workspaceId === "") {
    return;
  }

  // Stored as-is and never trusted. `requireWorkspace` checks it against the
  // member's own workspaces on the next request, so a hand-edited value picks
  // nothing they could not already reach.
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/");
}

export function WorkspaceSwitcher({
  memberships,
  active,
}: {
  memberships: readonly Membership[];
  active: Membership;
}) {
  if (memberships.length < 2) {
    return null;
  }

  return (
    <form action={switchWorkspace}>
      <label htmlFor="workspaceId">Workspace</label>{" "}
      <select
        id="workspaceId"
        name="workspaceId"
        defaultValue={active.workspaceId}
      >
        {memberships.map((membership) => (
          <option key={membership.workspaceId} value={membership.workspaceId}>
            {membership.name}
          </option>
        ))}
      </select>{" "}
      <button type="submit">Switch</button>
    </form>
  );
}
