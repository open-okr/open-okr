import { Card, CardBody, CardHeader } from "@openokr/ui";
import { pageTitle } from "../../../lib/page-title.ts";
import { getTranslations } from "../../../lib/translations";
import { DirectoryTokenForm } from "./directory-form";

export const generateMetadata = pageTitle("pageTitle.adminDirectory");

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
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">
          {t("admin.directory.directorySynchronisation")}
        </h1>
        <p className="max-w-prose text-ink-3 text-sm">
          {t("admin.directory.intro")}
        </p>
      </header>

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="font-semibold text-ink text-sm">
            {t("admin.directory.scimEndpoint")}
          </h2>
          <p className="text-ink-3 text-xs">
            {t("admin.directory.configureThisUrl")}
          </p>
        </CardHeader>
        <DirectoryTokenForm scimPath={SCIM_PATH} />
      </Card>

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="font-semibold text-ink text-sm">
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
