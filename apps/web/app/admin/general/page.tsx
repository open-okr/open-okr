import { callAction } from "@openokr/core";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { GeneralSettingsForm } from "./general-settings-form";
import { WorkspaceStateCard } from "./workspace-state-card";

export default async function GeneralSettingsPage() {
  const { t } = await getTranslations();

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
    <div className="flex flex-col gap-4.5">
      <h1 className="text-lg font-bold text-ink">
        {t("admin.general.general")}
      </h1>
      <GeneralSettingsForm settings={read.settings} />
      {/*
       * The freeze switch (P6-G25). `workspace.setState` shipped at P2-T09
       * and no screen ever called it, so P6-T07's rehearsal runbook asked an
       * operator to press something that did not exist.
       */}
      <WorkspaceStateCard state={workspace.state} />
    </div>
  );
}
