import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../lib/access";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { createSpace } from "./actions.ts";
import { SpaceForm } from "./space-form.tsx";

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

  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const spaces = await callAction(context, "spaces.list", {});

  // Creating a space is a workspace administrator's call, the same level the
  // action declares. Below it the form is not drawn, and the action refuses
  // anyway: a hidden control is cosmetic.
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canCreate = level >= ACCESS_LEVELS.full;
  const members = canCreate
    ? await callAction(context, "people.directory", {})
    : [];

  return (
    <AppShellLayout>
      <div className="stagger flex flex-col gap-4.5">
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
                No spaces yet. Provisioning makes one named after the workspace,
                so an empty list means it was archived.
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

        {canCreate ? (
          <Card>
            <CardHeader>
              <div className="flex min-w-0 flex-col">
                <h2 className="text-sm font-bold text-ink">Create a space</h2>
                <p className="text-xs text-ink-3">
                  A team home. Its manager covers the coordinator's duties until
                  somebody else is named (§4.2).
                </p>
              </div>
            </CardHeader>
            <CardBody>
              <SpaceForm action={createSpace} className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Name
                  <input
                    name="name"
                    required
                    maxLength={80}
                    placeholder="Product, Sales, Platform"
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Mission
                  <input
                    name="mission"
                    maxLength={280}
                    placeholder="What this team is for, in one line"
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Manager
                  <select
                    name="managerMemberId"
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  >
                    <option value="">Nobody yet</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                >
                  Create the space
                </button>
              </SpaceForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </AppShellLayout>
  );
}
