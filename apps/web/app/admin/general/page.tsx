import {
  callAction,
  deploymentInstanceName,
  isCloudEnabled,
  readInstanceName,
  readRegistrationPolicy,
  readUpdateCheck,
} from "@openokr/core";
import { listTimezones } from "@openokr/formats";
import { getPool } from "../../../lib/auth";
import { heldBy } from "../../../lib/held-by";
import { getMailSettings } from "../../../lib/mail";
import { pageTitle } from "../../../lib/page-title.ts";
import { schedulerState } from "../../../lib/scheduler";
import { tenantFloor } from "../../../lib/tenant-floor";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ConsoleMailNotice } from "./console-mail-notice";
import { GeneralSettingsForm } from "./general-settings-form";
import { InstanceHealthNotice } from "./instance-health-notice";
import { InstanceNameCard } from "./instance-name-card";
import { RegistrationCard } from "./registration-card";
import { SetupCard } from "./setup-card";
import { UpdateCheckCard } from "./update-check-card";
import { WorkspaceStateCard } from "./workspace-state-card";

export const generateMetadata = pageTitle("pageTitle.adminGeneral");

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

  // Read rather than assumed: the transport can come from the environment or
  // from a stored row, and this screen should say what the instance will
  // actually do rather than what its default would be. Never fatal to the
  // page: an admin screen that would not render because mail could not be
  // resolved would hide the very settings somebody came here to fix.
  const mail = await getMailSettings().catch(() => ({
    transport: "smtp" as const,
  }));
  // Neither is fatal to the page either, for the same reason.
  const floor = await tenantFloor().catch(() => "enforced" as const);
  // The instance's own name (M-33). Not offered on a managed cloud, where it
  // is the operator's rather than any customer's, and not fatal when the
  // settings cannot be read: the card is left out rather than the page.
  const cloud = await isCloudEnabled(getPool()).catch(() => true);
  const instanceName = cloud
    ? null
    : await readInstanceName(getPool()).catch(() => null);
  // Who may register (docs/design/registration-policy.md). Absent on a cloud
  // like the name, and left out rather than failing the page.
  const registration = cloud
    ? null
    : await readRegistrationPolicy(getPool()).catch(() => null);
  // docs/design/version-footer.md §4. Absent on a managed cloud, like the
  // name, and left out rather than failing the page when it cannot be read.
  const updateCheck = cloud
    ? null
    : await readUpdateCheck(getPool()).catch(() => null);

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
      <InstanceHealthNotice
        tenantFloorBypassed={floor === "bypassed"}
        schedulerFailed={schedulerState() === "failed"}
      />
      {mail.transport === "console" ? <ConsoleMailNotice /> : null}
      <GeneralSettingsForm settings={read.settings} zones={listTimezones()} />
      {instanceName ? (
        <InstanceNameCard
          name={instanceName.value}
          source={instanceName.source}
          deploymentName={deploymentInstanceName()}
        />
      ) : null}
      {registration ? (
        <RegistrationCard
          policy={registration.value}
          source={registration.source}
        />
      ) : null}
      {updateCheck ? <UpdateCheckCard enabled={updateCheck.value} /> : null}
      {/*
       * S-34 offered again (completeness review L-08). The registry's default
       * for `onboardingDone` is true, so only a stored `false` is pending.
       */}
      <SetupCard done={read.settings.onboardingDone !== false} />
      {/*
       * The freeze switch (P6-G25). `workspace.setState` shipped at P2-T09
       * and no screen ever called it, so P6-T07's rehearsal runbook asked an
       * operator to press something that did not exist.
       */}
      <WorkspaceStateCard
        state={workspace.state}
        heldBy={await heldBy(workspace.workspaceId)}
      />
    </div>
  );
}
