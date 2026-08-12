import { callAction } from "@openokr/core";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { BrandingSettingsForm } from "./branding-settings-form";

export default async function BrandingSettingsPage() {
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
      <h1>Branding</h1>
      <BrandingSettingsForm
        branding={(read.settings.branding as Record<string, unknown>) ?? {}}
      />
    </>
  );
}
