import { callAction, OperationError } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { notFound } from "next/navigation";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { SpaceMembership } from "./space-membership";

/**
 * A space home (TECHNICAL-PLAN §4.2, P3-T01).
 *
 * The shell, deliberately. A space home eventually carries the space's goals,
 * its KPI trees, its weekly session and its feed, and every one of those is a
 * later Phase 3 or Phase 4 task. What is real here is the membership model:
 * who is in the space, in what role, who runs its weekly session, and the join
 * or leave action for the reader.
 */
export default async function SpacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, workspace } = await requireWorkspace();

  let space: Awaited<ReturnType<typeof callAction<"spaces.read">>>;
  try {
    space = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "spaces.read",
      { id },
    );
  } catch (error) {
    // A space the reader may not see is indistinguishable from one that does
    // not exist (§8.1 layer 2).
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  return (
    <AppShellLayout>
      <div className="stagger mx-auto flex max-w-3xl flex-col gap-4.5">
        <Card>
          <CardHeader>
            <h1 className="text-lg font-bold text-ink">{space.name}</h1>
            {space.mission ? (
              <p className="text-sm text-ink-3">{space.mission}</p>
            ) : null}
          </CardHeader>
          <CardBody className="flex flex-col gap-3.5">
            <SpaceMembership spaceId={space.id} ownRole={space.ownRole} />
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-ink-2">
                Members ({space.memberCount})
              </h2>
              <ul className="flex flex-col gap-1.5">
                {space.members.map((member) => (
                  <li
                    key={member.memberId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-ink">{member.name}</span>
                    <span className="flex items-center gap-2">
                      <Chip
                        tone={member.role === "member" ? "neutral" : "brand"}
                      >
                        {member.role}
                      </Chip>
                      {member.memberId === space.coordinatorMemberId ? (
                        <Chip tone="info">runs the weekly session</Chip>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {space.coordinatorMemberId &&
              !space.members.some(
                (member) =>
                  member.memberId === space.coordinatorMemberId &&
                  member.role === "coordinator",
              ) ? (
                <p className="text-sm text-ink-3">
                  No coordinator is named, so a manager covers those duties.
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
