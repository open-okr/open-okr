import { callAction, navigationFor, OperationError } from "@openokr/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../lib/access";
import { getPool } from "../lib/auth";
import type { ActiveWorkspace } from "../lib/workspace";
import { RenameWorkspace } from "./rename-workspace";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * The proving dashboard's content (P1-T08).
 *
 * Everything it shows comes from one registry action, not from queries of its
 * own. That is the point of the page: the browser sees exactly what REST,
 * the command line and the agent tool catalogue will see, because all of them
 * project from the same contract.
 *
 * An async server component, rendered inside a Suspense boundary so the shell
 * paints before the database answers (§13.3, server-streamed first paint).
 */
export async function WorkspaceOverview({
  active,
}: {
  active: ActiveWorkspace;
}) {
  const { session, workspace, memberships } = active;

  let overview: Awaited<ReturnType<typeof callAction<"workspace.overview">>>;
  try {
    overview = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "workspace.overview",
      {},
    );
  } catch (error) {
    // Forbidden reads collapse to not-found (§8.1 layer 2), so a person who
    // may not see this workspace cannot tell it apart from one that does not
    // exist. Anything else is a real fault and belongs to the error boundary.
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  // The module registry's own "hidden below the level" half: an admin link
  // this member's level does not reach never renders, the same requirement
  // the admin layout itself denies the route for if it is visited directly.
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const adminLinks = navigationFor("admin", level);

  return (
    <>
      <p>
        Signed in as <strong>{overview.member.name}</strong>, in{" "}
        <strong>{overview.workspace.name}</strong>.
      </p>

      <dl>
        <dt>Workspace</dt>
        <dd>
          {overview.workspace.name} ({overview.workspace.slug})
        </dd>
        <dt>State</dt>
        <dd>{overview.workspace.state}</dd>
        <dt>Timezone</dt>
        <dd>{overview.workspace.timezone}</dd>
        <dt>Language</dt>
        <dd>{overview.workspace.language}</dd>
        <dt>Your membership</dt>
        <dd>
          {overview.member.kind}, {overview.member.status}, notified by{" "}
          {overview.member.primaryChannel}
        </dd>
      </dl>

      <WorkspaceSwitcher memberships={memberships} active={workspace} />
      <RenameWorkspace name={overview.workspace.name} />

      {adminLinks.length > 0 && (
        <p>
          {adminLinks.map((item, index) => (
            <span key={item.id}>
              {index > 0 && " · "}
              <Link href={item.href}>{item.label}</Link>
            </span>
          ))}
        </p>
      )}
    </>
  );
}
