import type { Membership } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE } from "../lib/workspace";
import { WorkspaceSelect } from "./workspace-select.tsx";

/**
 * The workspace switcher (UIUX-PLAN §3: "a workspace switcher sits at the
 * top for members of more than one workspace", P2-T10).
 *
 * The brandmark always renders — a member with one workspace still needs
 * to see which one they are in. Only the actual switching control (the
 * `<select>` and its submit) is conditional on having somewhere else to
 * switch to; a control with one option is noise, which is P1-T06's
 * original reasoning and is unchanged here.
 *
 * A native `<select>` and a Server Function rather than a styled dropdown
 * and a click handler: the choice works with JavaScript off, which
 * S-35/P2-T10's own progressive-enhancement decision (see
 * `(auth)/auth-card.tsx`) treats as worth keeping wherever it is this
 * cheap.
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "") +
    (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
  ).toUpperCase();
}

export function WorkspaceSwitcher({
  memberships,
  active,
}: {
  memberships: readonly Membership[];
  active: Membership;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg p-1.5">
      <span
        aria-hidden="true"
        className="grid size-7 flex-none place-items-center rounded-lg bg-gradient-to-br from-[#6265f0] via-brand to-[#7c3aed] text-sm font-extrabold text-on-brand shadow-brand-hover"
      >
        {initialsOf(active.name)}
      </span>
      <div className="hidden min-w-0 flex-1 xl:block">
        <div className="truncate text-sm font-semibold tracking-tight text-ink">
          {active.name}
        </div>
        {memberships.length > 1 ? (
          <form action={switchWorkspace}>
            <label htmlFor="workspaceId" className="sr-only">
              Workspace
            </label>
            <WorkspaceSelect
              memberships={memberships}
              activeWorkspaceId={active.workspaceId}
            />
            <noscript>
              <button type="submit" className="text-xs text-ink-4 underline">
                Switch
              </button>
            </noscript>
          </form>
        ) : null}
      </div>
    </div>
  );
}
