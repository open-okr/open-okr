import { readSetupState } from "@openokr/core";
import { buttonVariants, cn } from "@openokr/ui";
import Link from "next/link";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { FinishSetup } from "./finish-setup";
import { SetupAccountForm } from "./setup-account-form";

/**
 * The wizard's account step (P1-T09).
 *
 * The account is created through the same Better Auth path everybody else
 * uses, and the workspace through the same provisioning hook. A setup wizard
 * that created accounts its own way would be a second authentication path, and
 * a hard rule says there is only one.
 *
 * So this page owns nothing except the last act: recording that setup is
 * finished, and closing registration behind it.
 *
 * Two states, because the wizard has to be resumable. If the account was
 * created and recording completion then failed, coming back here must offer to
 * finish rather than a form that can only fail on a duplicate address.
 */
export const dynamic = "force-dynamic";

export default async function SetupAccountPage() {
  const { t } = await getTranslations();

  const state = await readSetupState(getPool());

  if (state.hasUser) {
    return (
      <>
        <h1 className="text-lg font-bold text-ink">
          {t("setup.account.finishSetup")}
        </h1>
        <p className="text-sm text-ink-3">
          {t("setup.account.anAccountAlreadyExists")}
        </p>
        <FinishSetup />
        <Link
          href="/sign-in"
          className="text-sm font-medium text-brand-text hover:underline"
        >
          {t("setup.account.signIn")}
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-lg font-bold text-ink">
        {t("common.createTheFirstAccount")}
      </h1>
      <p className="text-sm text-ink-3">
        {t("setup.account.thisAccountOwnsThe")}
      </p>

      <SetupAccountForm />

      <Link
        href="/setup"
        className={cn(buttonVariants({ variant: "ghost" }), "self-start")}
      >
        {t("setup.account.back")}
      </Link>
    </>
  );
}
