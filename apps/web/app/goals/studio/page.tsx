import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { Studio } from "./studio.tsx";

/**
 * The alignment studio (UIUX-PLAN.md §4 S-16, P3-T10).
 *
 * The cascade as a canvas, with the alignment score and its gaps beside it. The
 * data is server-rendered and the interaction is client-owned, which is the
 * split §13.3 asks for: a canvas is an interactive surface, and the tree behind
 * it is a read.
 */
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
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
  const canEdit = level >= ACCESS_LEVELS.edit;

  const cycles = await callAction(context, "cycles.list", {});
  const current = await callAction(context, "cycles.current", {
    mode: "quarterly",
  });
  const query = await searchParams;
  const cycleId = query.cycle ?? current?.id ?? cycles[0]?.id ?? null;

  if (!cycleId) {
    return (
      <AppShellLayout>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">There is no cycle to draw yet.</p>
          </CardBody>
        </Card>
      </AppShellLayout>
    );
  }

  const graph = await callAction(context, "alignment.graph", { cycleId });
  const alignment = await callAction(context, "alignment.read", {
    cycleId,
    includeDismissed: false,
  });

  return (
    <AppShellLayout>
      <div className="flex flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">Alignment studio</h1>
              <p className="text-xs text-ink-3">
                The cascade, with dashed lines for horizontal dependencies.
              </p>
            </div>
            <a href="/goals" className="text-xs text-brand-text underline">
              Back to the list
            </a>
          </CardHeader>
        </Card>

        <Studio
          nodes={graph.nodes}
          edges={graph.edges}
          findings={alignment.findings}
          score={alignment.score}
          healthy={alignment.healthy}
          threshold={alignment.threshold}
          canEdit={canEdit}
        />
      </div>
    </AppShellLayout>
  );
}
