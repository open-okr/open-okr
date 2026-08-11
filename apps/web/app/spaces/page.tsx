import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";

/**
 * The space list (TECHNICAL-PLAN §4.2, P3-T01).
 *
 * The shell for team homes, not the home itself: S-01's Work Map and the goal
 * surfaces are what a space page eventually holds, and both are later tasks.
 * What this proves now is that the access model reaches spaces correctly, which
 * is what P3-T01 is actually for. Every space a member can see is here, with
 * their own role in it, or a join action when they have none.
 *
 * Everything shown comes from one registry action. The page runs no query.
 */
export default async function SpacesPage() {
  const { session, workspace } = await requireWorkspace();

  const spaces = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "spaces.list",
    {},
  );

  return (
    <AppShellLayout>
      <div className="stagger mx-auto flex max-w-3xl flex-col gap-4.5">
        <Card>
          <CardHeader>
            <h1 className="text-lg font-bold text-ink">Spaces</h1>
            <p className="text-sm text-ink-3">
              Team homes. Every space is visible to everyone here; being in one
              is what lets you work in it.
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {spaces.length === 0 ? (
              <p className="text-sm text-ink-3">
                No spaces yet. A workspace admin creates the first one.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {spaces.map((space) => (
                  <li key={space.id}>
                    <Link
                      href={`/spaces/${space.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-bg-2"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium text-ink">
                          {space.name}
                        </span>
                        {space.mission ? (
                          <span className="text-sm text-ink-3">
                            {space.mission}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular text-sm text-ink-3">
                          {space.memberCount}{" "}
                          {space.memberCount === 1 ? "member" : "members"}
                        </span>
                        {space.ownRole ? (
                          <Chip tone="brand">{space.ownRole}</Chip>
                        ) : (
                          <Chip tone="neutral">not a member</Chip>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
