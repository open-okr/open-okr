import {
  COMPANY_EMAIL_MESSAGE,
  inviteTokenFromCookies,
  REGISTRATION_CLOSED_MESSAGE,
  registrationOpenOrInvited,
  registrationRefusal,
  resolveLegalLinks,
} from "@openokr/core";
import { headers } from "next/headers";
import Link from "next/link";
import { getPool } from "../../../lib/auth";
import { pageTitle } from "../../../lib/page-title.ts";
import { getTranslations } from "../../../lib/translations";
import { AuthCard } from "../auth-card";
import { SignUpForm } from "./sign-up-form";

export const generateMetadata = pageTitle("pageTitle.signUp");

/**
 * Registration (screen S-35), which the plan describes as available "where
 * enabled". The policy is set on Admin → General: invitation only, company
 * addresses, or anyone (docs/design/registration-policy.md).
 *
 * Showing the form on a closed instance would be a form that cannot succeed,
 * so the page asks first. The endpoint refuses independently: this is the
 * courtesy, not the control.
 */

// Registration opens and closes while the instance runs, so this page cannot
// be prerendered into a build artifact that says whichever was true that day.
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const { t } = await getTranslations();

  // **The invitation counts here too, and it did not until P6-G06b.** This
  // asked `isRegistrationOpen`, which is the narrower question, so a closed
  // instance told an invitee "Registration is closed" and never rendered a
  // form that Better Auth's own hook would have accepted: the invitation was
  // redeemable and unreachable at the same time. One function answers for both
  // now. The end-to-end spec found it by pressing the button and waiting for a
  // name field that was never going to appear.
  const cookieHeader = (await headers()).get("cookie");
  if (!(await registrationOpenOrInvited(getPool(), cookieHeader))) {
    return (
      <AuthCard
        title={t("auth.signUp.registrationIsClosed")}
        footer={
          <Link
            href="/sign-in"
            className="font-medium text-brand-text hover:underline"
          >
            {t("common.backToSignIn")}
          </Link>
        }
      >
        <p className="text-sm text-ink-2">{REGISTRATION_CLOSED_MESSAGE}</p>
      </AuthCard>
    );
  }

  // Open to company addresses only: a free address would be refused, so the
  // form says so up front. Not for an invitee, whom the invitation admits
  // whatever their address.
  const companyOnly =
    inviteTokenFromCookies(cookieHeader) === null &&
    (await registrationRefusal(
      getPool(),
      cookieHeader,
      "someone@gmail.com",
    )) === COMPANY_EMAIL_MESSAGE;

  return (
    <SignUpForm
      companyOnly={companyOnly}
      legal={await resolveLegalLinks(getPool())}
    />
  );
}
