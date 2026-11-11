import {
  EMAIL_VERIFICATION_LINK_SECONDS,
  resolveSupportEmail,
} from "@openokr/core";
import { buttonVariants } from "@openokr/ui";
import Link from "next/link";
import { getPool } from "../../../lib/auth";
import { getInstanceName } from "../../../lib/instance-name";
import { pageTitle } from "../../../lib/page-title.ts";
import { getTranslations } from "../../../lib/translations";
import { AuthCard } from "../auth-card";
import { ResendForm } from "../resend-link";

export const generateMetadata = pageTitle("pageTitle.emailConfirmed");

// What the page says depends on the query and on the instance's own name and
// support address, so it is never prerendered.
export const dynamic = "force-dynamic";

/**
 * Where the link in a sign-up's confirmation mail lands (plan 0.8.0 S2,
 * screen S-35).
 *
 * Sign-up names this page as Better Auth's `callbackURL`. Better Auth confirms
 * the address and redirects here, or redirects here with `?error=` when it
 * cannot. Before this the link returned to the home page, which sent a person
 * with no session to sign in with no word that anything had worked.
 *
 * **Signed out on purpose.** Better Auth signs nobody in when it confirms an
 * address here (`autoSignInAfterVerification` is off), so the page offers the
 * sign-in rather than pretending there is a session. An address confirmed
 * before reaches the same page with no error, which is the right answer for
 * it too.
 *
 * **An expired or broken link offers a new one** (plan 0.8.0 S3): type the
 * address and Better Auth's own resend sends a link to it if it waits to be
 * confirmed, with the same answer whether or not it has an account. Whoever
 * runs the instance is named below, for somebody still stuck.
 */
export default async function EmailConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { t } = await getTranslations();
  const raw = (await searchParams).error;
  const error = Array.isArray(raw) ? raw[0] : raw;
  const backToSignIn = (
    <Link
      href="/sign-in"
      className="font-medium text-brand-text hover:underline"
    >
      {t("common.backToSignIn")}
    </Link>
  );

  if (!error) {
    return (
      <AuthCard
        title={t("auth.emailConfirmed.welcome", {
          instance: await getInstanceName(),
        })}
      >
        <div className="flex flex-col gap-3" data-testid="email-confirmed">
          <p className="text-sm text-ink-2">
            {t("auth.emailConfirmed.confirmed")}
          </p>
          <Link
            href="/sign-in"
            className={buttonVariants({ variant: "primary" })}
          >
            {t("auth.emailConfirmed.signIn")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  const support = await resolveSupportEmail(getPool());
  const hours = EMAIL_VERIFICATION_LINK_SECONDS / 3600;
  const expired = error === "TOKEN_EXPIRED";

  return (
    <AuthCard
      title={
        expired
          ? t("auth.emailConfirmed.expiredTitle")
          : t("auth.emailConfirmed.invalidTitle")
      }
      footer={backToSignIn}
    >
      <div
        className="flex flex-col gap-2.5 text-sm text-ink-2"
        data-testid={expired ? "email-link-expired" : "email-link-invalid"}
      >
        <p>
          {expired
            ? hours === 1
              ? t("auth.emailConfirmed.expiredOneHour")
              : t("auth.emailConfirmed.expiredHours", { hours })
            : t("auth.emailConfirmed.invalidBody")}
        </p>
        <p>{t("auth.emailConfirmed.typeYourEmail")}</p>
        <ResendForm hours={hours} />
        <p className="text-ink-3">
          {support ? (
            <>
              {t("auth.emailConfirmed.writeTo")}{" "}
              <a
                className="font-medium text-brand-text hover:underline"
                href={`mailto:${support}`}
              >
                {support}
              </a>
            </>
          ) : (
            t("auth.emailConfirmed.askWhoRunsIt")
          )}
        </p>
      </div>
    </AuthCard>
  );
}
