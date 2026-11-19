import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { intlTagFor } from "@openokr/formats";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { browseAudit } from "./actions";
import { AuditPanel } from "./audit-panel";

export const generateMetadata = pageTitle("pageTitle.adminAudit");

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
  const { t, locale } = await getTranslations();

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
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="font-bold text-ink text-lg">
            {t("admin.audit.title")}
          </h1>
        </header>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3" data-testid="audit-log-denied">
              {t("admin.audit.log.denied")}
            </p>
          </CardBody>
        </Card>
      </div>
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
  const [first, directory, settings, names] = await Promise.all([
    browseAudit({}),
    callAction(context, "people.directory", { includeSuspended: true }),
    callAction(context, "settings.readForMember", {}),
    callAction(context, "audit.names", {}),
  ]);

  const members = directory
    .map((member) => ({ id: member.id, name: member.name }))
    .sort((a, b) => a.name.localeCompare(b.name, intlTagFor(locale)));
  const timeZone = String(settings.settings.timezone ?? "UTC");

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">{t("admin.audit.title")}</h1>
        <p className="max-w-prose text-ink-3 text-sm">
          {t("admin.audit.intro")}
        </p>
      </header>

      <AuditPanel
        members={members}
        names={names}
        timeZone={timeZone}
        initial={first}
      />

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="font-semibold text-ink text-sm">
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
