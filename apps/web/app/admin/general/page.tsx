import { callAction } from "@openokr/core";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { GeneralSettingsForm } from "./general-settings-form";

export default async function GeneralSettingsPage() {
  const { session, workspace } = await requireWorkspace();
  const read = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "settings.readWorkspaceSettings",
    {},
  );

  return (
    <>
      <h1>General</h1>
      <GeneralSettingsForm settings={read.settings} />
    </>
  );
}
