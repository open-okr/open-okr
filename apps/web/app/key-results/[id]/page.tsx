import { callAction } from "@openokr/core";
import { notFound, redirect } from "next/navigation";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * A key result's short link (docs/design/short-ids.md S6, plan 0.7.0 D1).
 *
 * A key result has no page of its own: it is a row on its goal's page, and
 * the goal page anchors each row as `#kr-<id>`. "Copy link" on that row copies
 * `/key-results/<short id>`, and this sends it there.
 *
 * Through `search.jump`, which finds the key result by its short id under the
 * reader's own access and answers the goal's address with the row's anchor.
 * Anything it does not find, unknown or unseen alike, is the not-found page.
 */
export default async function KeyResultLink({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  // Longer than any short id: the jump's input would refuse it as invalid,
  // and an address that names nothing is a not-found, not an error.
  if (id.length > 40) {
    notFound();
  }
  const found = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "search.jump",
    { shortId: id, kinds: ["key_result"] },
  );
  if (!found) {
    notFound();
  }
  redirect(found.href);
}
