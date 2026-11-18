import { isDemoAccount, passwordCardFor } from "@openokr/core";
import { getPool } from "../../../lib/auth";
import { pageTitle } from "../../../lib/page-title.ts";
import { requireSession } from "../../../lib/session";
import { getTranslations } from "../../../lib/translations";
import { DataExport } from "./data-export";
import { setPassword } from "./password-actions";
import { PasswordCard } from "./password-card";
import { SecuritySettings } from "./security-settings";
import { Sessions } from "./sessions";

export const generateMetadata = pageTitle("pageTitle.security");

/**
 * A protected page: `requireSession` redirects a signed-out visitor to sign
 * in rather than rendering a shell that assumes a user.
 *
 * **The password comes first** (plan 0.8.0 Y3): change it, or set one where
 * the account has none. What the card offers is decided here, on the server,
 * from the account as it is now.
 */
export default async function SecurityPage() {
  const { t } = await getTranslations();

  const session = await requireSession();
  const password = await passwordCardFor(getPool(), {
    userId: session.user.id,
    email: session.user.email,
    sessionCreatedAt: session.session.createdAt,
  });

  const GROUP = "text-xs font-semibold uppercase tracking-wide text-ink-4";
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {t("account.security.security")}
        </h1>
        <p className="max-w-prose text-sm text-ink-3">
          {t("account.security.signedInAs", { email: session.user.email })}
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={GROUP}>{t("account.security.group.signIn")}</h2>
        <span className="rounded-full bg-raised px-2 font-semibold text-ink-3 text-xs">
          {t("account.security.group.appliesAtOnce")}
        </span>
      </div>
      <PasswordCard card={password} setPassword={setPassword} />
      {/*
       * Both draw their own cards, one per heading, rather than being wrapped
       * in one here. Passkeys, one-time codes and signed-in devices are three
       * separate decisions and they used to share a box.
       */}
      <SecuritySettings
        twoFactorEnabled={session.user.twoFactorEnabled === true}
        demo={isDemoAccount(session.user.email)}
      />
      <h2 className={GROUP}>{t("account.security.group.devicesAndData")}</h2>
      <Sessions userId={session.user.id} />
      <DataExport />
    </div>
  );
}
