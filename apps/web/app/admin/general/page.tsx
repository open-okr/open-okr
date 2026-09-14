import { callAction } from "@openokr/core";
import { getPool } from "../../../lib/auth";
import { getMailSettings } from "../../../lib/mail";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ConsoleMailNotice } from "./console-mail-notice";
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

  // Read rather than assumed: the transport can be set by environment or by
  // a stored row, and this screen should say what the instance will actually
  // do rather than what its default would be. Never fatal to the page: an
  // admin screen that would not render because mail could not be resolved
  // would hide the very settings somebody came here to fix.
  // Read rather than assumed: the transport can come from the environment or
  // from a stored row, and this screen should say what the instance will
  // actually do rather than what its default would be. Never fatal to the
  // page: an admin screen that would not render because mail could not be
  // resolved would hide the very settings somebody came here to fix.
  const mail = await getMailSettings().catch(() => ({
    transport: "smtp" as const,
  }));

  return (
    <div className="flex flex-col gap-4.5">
      <h1 className="text-lg font-bold text-ink">
        {t("admin.general.general")}
      </h1>
      {/*
       * **Shown whenever the transport is console, with no grace period**
       * (P7-T08d). A threshold was the first design and it was wrong: an
       * operator on day one also needs to know their invitations are going
       * to the log rather than to anybody, and a warning that waits a week
       * is a week of invitations nobody received. The notice says what is
       * happening rather than scolding, so it costs a legitimate evaluation
       * nothing to read it.
       */}
      {mail.transport === "console" ? <ConsoleMailNotice /> : null}
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
