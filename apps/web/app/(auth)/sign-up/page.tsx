import { isRegistrationOpen, REGISTRATION_CLOSED_MESSAGE } from "@openokr/core";
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
  if (!(await isRegistrationOpen(getPool()))) {
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
