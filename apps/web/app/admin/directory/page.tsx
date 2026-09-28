import { Card, CardBody, CardHeader } from "@openokr/ui";
import { getTranslations } from "../../../lib/translations";
import { DirectoryTokenForm } from "./directory-form";

/**
 * Admin directory sync configuration (P8-T08).
 *
 * Generates a SCIM bearer token for the workspace. The identity provider
 * uses this token to push user and group changes to the SCIM endpoint.
 */
/** Where the identity provider sends its requests. A path, not prose. */
const SCIM_PATH = "/api/scim/v2";

export default async function DirectoryPage() {
  const { t } = await getTranslations();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">
            {t("admin.directory.directorySynchronisation")}
          </h2>
          <p className="text-sm text-ink-3">{t("admin.directory.intro")}</p>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-ink/10 p-4">
              <h3 className="text-sm font-medium text-ink">
                {t("admin.directory.scimEndpoint")}
              </h3>
              <p className="mt-1 font-mono text-sm text-ink-3">
                {typeof window !== "undefined"
                  ? `${window.location.origin}${SCIM_PATH}`
                  : SCIM_PATH}
              </p>
              <p className="mt-2 text-xs text-ink-3">
                {t("admin.directory.configureThisUrl")}
              </p>
            </div>
            <DirectoryTokenForm />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">
            {t("admin.directory.howItWorks")}
          </h2>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-ink-2 space-y-2">
            <p>{t("admin.directory.whenAUserIsAdded")}</p>
            <p>{t("admin.directory.whenAUserIsRemoved")}</p>
            <p>{t("admin.directory.groupsMapToSpaces")}</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
