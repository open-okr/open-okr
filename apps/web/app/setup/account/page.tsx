import { readSetupState } from "@openokr/core";
import Link from "next/link";
import { getPool } from "../../../lib/auth";
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
  const state = await readSetupState(getPool());

  if (state.hasUser) {
    return (
      <>
        <h1>Finish setup</h1>
        <p>
          An account already exists on this instance, but setup was never
          recorded as finished. Sign in as that account if you are not already,
          then finish here. Finishing closes registration, so everybody after
          the first account joins by invitation.
        </p>
        <FinishSetup />
        <p>
          <Link href="/sign-in">Sign in</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Create the first account</h1>
      <p>
        This account owns the instance. Registration closes once it exists, so
        everybody after you joins by invitation.
      </p>

      <SetupAccountForm />

      <p>
        <Link href="/setup">Back</Link>
      </p>
    </>
  );
}
