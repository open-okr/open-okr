import { NextResponse } from "next/server";
import { resolveAccessLevelFor } from "../../../../lib/access.ts";
import { loadReviewBadge } from "../../../../lib/review-badge";
import { requireWorkspace } from "../../../../lib/workspace";

/**
 * The sidebar's Review count, on its own (completeness review M-32).
 *
 * What `ReviewBadgeLive` asks after the workspace's feed moves, so that a
 * change nobody on this page made reaches the badge without a navigation. The
 * same read the badge renders from, so the two cannot disagree. The caller is
 * the session's own member; there is nothing to name and nobody else's count
 * to ask for.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let active: Awaited<ReturnType<typeof requireWorkspace>>;
  try {
    active = await requireWorkspace();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const { session, workspace } = active;
  const count = await loadReviewBadge(
    workspace.workspaceId,
    session.user.id,
    await resolveAccessLevelFor(workspace.workspaceId, workspace.memberId),
  );
  return NextResponse.json(
    { count },
    { headers: { "cache-control": "no-store" } },
  );
}
