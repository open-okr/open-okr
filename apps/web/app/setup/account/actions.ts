"use server";

import { completeSetup, readSetupState } from "@openokr/core";
import { getPool } from "../../../lib/auth";
import { getKeyRing } from "../../../lib/secrets";
import { currentSession } from "../../../lib/session";
import { getTranslations } from "../../../lib/translations";

/**
 * Finishing setup, from the browser (P1-T09).
 *
 * A server action rather than a route handler, so the wizard works without a
 * page of its own for the submission and the client keeps its state if this
 * fails.
 *
 * Guarded here as well as in the layout. The layout stops somebody *seeing*
 * the wizard on a configured instance; this stops somebody *calling* it, and a
 * server action is directly reachable whatever the page above it rendered.
 * `completeSetup` refuses a second claim under an advisory lock regardless, so
 * this is the third of three.
 */
export interface FinishSetupInput {
  readonly instanceName: string;
}

export type FinishSetupResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export async function finishSetup(
  input: FinishSetupInput,
): Promise<FinishSetupResult> {
  const { t } = await getTranslations();
  const pool = getPool();

  const state = await readSetupState(pool);
  if (state.configured) {
    return { ok: false, message: t("setup.account.actions.alreadySetUp") };
  }

  // An account must exist before setup can be recorded as done. Without this,
  // a direct call would close registration on an empty instance and lock
  // everybody out, including the person who ran it.
  if (!state.hasUser) {
    return {
      ok: false,
      message: t("setup.account.actions.createTheFirstAccount"),
    };
  }

  // And the caller must be signed in as one. A server action is directly
  // reachable whatever page rendered above it, and without this check an
  // anonymous visitor could finish setup and name the instance during the
  // window between the operator creating their account and clicking finish.
  // The wizard's own flow always has a session here, because signing up
  // signs you in.
  if (!(await currentSession())) {
    return {
      ok: false,
      message: t("setup.account.actions.signInAsThatAccount"),
    };
  }

  // Validated at the boundary like any other external input. The bound is
  // generous; the point is that an unbounded string cannot become a settings
  // row.
  if (
    typeof input.instanceName !== "string" ||
    input.instanceName.length > 120
  ) {
    return {
      ok: false,
      message: t("setup.account.actions.instanceNameTooLong"),
    };
  }

  const name = input.instanceName.trim();

  try {
    await completeSetup(pool, getKeyRing(), {
      settings: name === "" ? [] : [{ key: "instance.name", value: name }],
      // Registration is open until the instance is claimed, and this is the
      // moment it is claimed.
      closeRegistration: true,
    });
    return { ok: true };
  } catch (error) {
    // The message reaches a browser, so only the first line, and never a
    // stack. Anything that references a credential is caught upstream by the
    // key ring, which never puts key material in an error.
    return {
      ok: false,
      message:
        error instanceof Error
          ? (error.message.split("\n")[0] ??
            t("setup.account.actions.unknownError"))
          : t("setup.account.actions.unknownError"),
    };
  }
}
