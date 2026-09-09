import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { redirect } from "next/navigation";
import { resolveAccessLevelFor } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { Wizard } from "./wizard.tsx";

/**
 * Onboarding, screen S-34 (P6-G26, GAP-AUDIT G-02).
 *
 * **A first sign-in as owner used to land on an empty Work Map.** Every
 * setting had a working default and nothing told the person who had just
 * created a workspace what to do with it, which is the gap the audit recorded
 * as G-02.
 *
 * **Outside the shell on purpose.** This is the one screen where the
 * navigation is not the answer: somebody who has never used the product has
 * nothing to navigate to yet, and a sidebar full of empty screens is the state
 * this exists to get them out of. It sits in no route group, so it takes the
 * root layout and nothing else.
 *
 * **It refuses to be reachable once it is done**, and by anybody it is not
 * for. A member below `full` never sees it, because the workspace's setup is
 * the owner's, and a workspace already marked done sends everybody home. Both
 * are redirects rather than empty states: there is no version of this screen
 * that is useful to somebody it is not for.
 */
export default async function WelcomePage() {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  if (level < ACCESS_LEVELS.full) {
    redirect("/");
  }

  const read = await callAction(context, "settings.readWorkspaceSettings", {});
  if (read.settings.onboardingDone !== false) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center p-6">
      <Wizard
        workspaceName={workspace.name}
        timezone={String(read.settings.timezone ?? "UTC")}
      />
    </main>
  );
}
