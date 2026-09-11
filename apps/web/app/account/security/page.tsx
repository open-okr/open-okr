import { Card, CardBody, CardHeader } from "@openokr/ui";
import { requireSession } from "../../../lib/session";
import { getTranslations } from "../../../lib/translations";
import { SecuritySettings } from "./security-settings";
import { Sessions } from "./sessions";

/**
 * A protected page: `requireSession` redirects a signed-out visitor to sign
 * in rather than rendering a shell that assumes a user.
 */
export default async function SecurityPage() {
  const { t } = await getTranslations();

  const session = await requireSession();

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-bold text-ink">
            {t("account.security.security")}
          </h1>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-ink-3">
            {t("account.security.signedInAs")} {session.user.email}
          </p>
        </CardBody>
      </Card>
      {/*
       * Both draw their own cards, one per heading, rather than being wrapped
       * in one here. Passkeys, one-time codes and signed-in devices are three
       * separate decisions and they used to share a box.
       */}
      <SecuritySettings
        twoFactorEnabled={session.user.twoFactorEnabled === true}
      />
      <Sessions userId={session.user.id} />
    </div>
  );
}
