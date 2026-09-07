import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { RhythmForm } from "./rhythm-form";

/**
 * The rhythm and thresholds card (UIUX-PLAN.md §4 S-36, TECHNICAL-PLAN §4.14,
 * METHOD.md §11, P3-T02).
 *
 * §11's registry, rendered from the registry itself rather than from a hand-kept
 * list of fields. Every parameter shows what this workspace resolves it to, what
 * the canon says, which METHOD.md section defines it and why that default is the
 * one shipped, because an admin about to change a threshold should be able to
 * read the argument for leaving it alone.
 */
export default async function RhythmSettingsPage() {
  const { session, workspace } = await requireWorkspace();

  const rhythm = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "rhythm.read",
    {},
  );

  // `rhythm.update` requires `full`, which is what `manage_coaching` grants.
  // Read here for the form's state; the server refuses regardless.
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  return (
    <>
      <h1>Rhythm and thresholds</h1>
      <p className="text-sm text-ink-3">
        Every number the method fires on, with the canon default beside it.
        Nothing here needs changing: a workspace that leaves this page alone
        practises the method as written.
      </p>
      <RhythmForm rhythm={rhythm} canManage={level >= ACCESS_LEVELS.full} />
    </>
  );
}
