import {
  REGISTRATION_CLOSED_MESSAGE,
  registrationOpenOrInvited,
} from "@openokr/core";
import { headers } from "next/headers";
import Link from "next/link";
import { getPool } from "../../../lib/auth";
import { AuthCard } from "../auth-card";
import { SignUpForm } from "./sign-up-form";

/**
 * Registration (screen S-35), which the plan describes as available "where
 * enabled". An instance is open until somebody claims it and invitation-only
 * afterwards (TECHNICAL-PLAN §4.14).
 *
 * Showing the form on a closed instance would be a form that cannot succeed,
 * so the page asks first. The endpoint refuses independently: this is the
 * courtesy, not the control.
 */

// Registration opens and closes while the instance runs, so this page cannot
// be prerendered into a build artifact that says whichever was true that day.
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
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
        title="Registration is closed"
        footer={
          <Link
            href="/sign-in"
            className="font-medium text-brand-text hover:underline"
          >
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-ink-2">{REGISTRATION_CLOSED_MESSAGE}</p>
      </AuthCard>
    );
  }

  return <SignUpForm />;
}
