import { Card, CardBody, CardHeader } from "@openokr/ui";
import { getTranslations } from "../../../lib/translations";
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
 * Two things on one screen because they are one question asked twice. The
 * verification says the trail has not been altered. The export hands over the
 * part of it somebody asked about. Neither is worth much without the other: a
 * file nobody can vouch for is a list of claims, and a verdict with no file
 * behind it is a reassurance.
 */
export default async function AuditPage() {
  const { t } = await getTranslations();

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
          <AuditPanel />
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
