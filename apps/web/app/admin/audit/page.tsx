import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { browseAudit } from "./actions";
import { AuditPanel } from "./audit-panel";

/**
 * The audit trail, for the person who has to answer for it (screen S-36,
 * P8-T10).
 *
 * The trail has been written since P1-T07 and hash-chained since P7-T02a, and
 * the only way to read either was a shell on the server. That is the wrong
 * place: the person an auditor asks is a workspace administrator, and the
 * answer they need is a file and a verdict rather than a database.
 *
 * Three things on one screen because they are one question asked three ways.
 * The verification says the trail has not been altered. The list shows it,
 * newest first, narrowed to the part somebody asked about (completeness
 * review L-19: until then it could be checked and taken away and not read).
 * The export hands that same part over. A file nobody can vouch for is a list
 * of claims, and a verdict with nothing to look at is a reassurance.
 */
export default async function AuditPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  // The layout already refuses below `full`. Checked again here because this
  // page names who did what, and a refusal belongs to the read rather than to
  // whichever layout happens to wrap it.
  if (level < ACCESS_LEVELS.full) {
    return (
      <Card>
        <CardHeader>
          <h1 className="text-base font-semibold text-ink">
            {t("admin.audit.title")}
          </h1>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-ink-3" data-testid="audit-log-denied">
            {t("admin.audit.log.denied")}
          </p>
        </CardBody>
      </Card>
    );
  }

  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  // The newest page is read here so the first paint has rows in it, which is
  // TECHNICAL-PLAN §13.3's line for settings. Suspended members are in the
  // directory because their rows are still in the trail and still theirs.
  const [first, directory, settings] = await Promise.all([
    browseAudit({}),
    callAction(context, "people.directory", { includeSuspended: true }),
    callAction(context, "settings.readForMember", {}),
  ]);

  const members = directory
    .map((member) => ({ id: member.id, name: member.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const timeZone = String(settings.settings.timezone ?? "UTC");

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h1 className="text-base font-semibold text-ink">
            {t("admin.audit.title")}
          </h1>
          <p className="text-sm text-ink-3">{t("admin.audit.intro")}</p>
        </CardHeader>
        <CardBody>
          <AuditPanel members={members} timeZone={timeZone} initial={first} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">
            {t("admin.audit.whatVerificationProves")}
          </h2>
        </CardHeader>
        <CardBody>
          <div className="space-y-2 text-sm text-ink-2">
            <p>{t("admin.audit.provesHashes")}</p>
            <p>{t("admin.audit.provesPending")}</p>
            <p>{t("admin.audit.provesExport")}</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
