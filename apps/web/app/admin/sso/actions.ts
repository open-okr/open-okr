"use server";

import { loadEnv } from "@openokr/config";
import {
  callAction,
  OperationError,
  SSOConnectionRejected,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { expireSSOProviders } from "../../../lib/sso";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import type { SSOEditInput, SSOWriteResult } from "./sso-result.ts";

/**
 * Changing, switching and removing a single sign-on connection (S-36).
 *
 * Every one goes through the action registry, which is where the access level,
 * the input schema and the validator live. Nothing here decides who may do
 * what, or what may be stored.
 *
 * **The key ring is on the context because an edit may seal a new client
 * secret**, and the instance's address because a SAML connection's derived
 * row names this instance. `sso.updateConnection` refuses a new secret from a
 * host that gave it no ring rather than storing it in the clear.
 *
 * **This process looks again at its next sign-in** (completeness review
 * L-15). Every process notices the change within a few seconds by itself;
 * this one saved it, so the administrator's next click meets it, the same as
 * the add route does.
 */
async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    ring: getKeyRing(),
    baseUrl: loadEnv().BETTER_AUTH_URL,
  };
}

/** A refusal the reader can act on, or a sentence saying nothing changed. */
async function refusal(
  error: unknown,
  action: string,
): Promise<SSOWriteResult> {
  if (error instanceof SSOConnectionRejected) {
    return { ok: false, message: error.message, field: error.field };
  }
  if (error instanceof OperationError) {
    return { ok: false, message: error.message };
  }
  // Anything else is a fault, not a refusal. The log says which; the reader
  // is told only that nothing changed, because a driver message is not a
  // sentence for them.
  console.error(`${action} failed:`, error);
  const { t } = await getTranslations();
  return { ok: false, message: t("admin.sso.actions.failed") };
}

/** After any write that landed: this process and this screen, both current. */
function saved(): SSOWriteResult {
  expireSSOProviders();
  revalidatePath("/admin/sso");
  return { ok: true };
}

/**
 * Saves the edit form.
 *
 * Only the fields of the connection's own protocol are sent, because the
 * action refuses the other protocol's rather than dropping them. A blank
 * client secret is left out, which keeps the stored one.
 */
export async function updateSSOConnectionAction(
  input: SSOEditInput,
): Promise<SSOWriteResult> {
  const protocol =
    input.kind === "saml"
      ? {
          samlEntryPoint: input.samlEntryPoint ?? "",
          samlIssuer: input.samlIssuer ?? "",
          samlCertificate: input.samlCertificate ?? "",
          samlAudience: input.samlAudience ?? "",
        }
      : {
          clientId: input.clientId ?? "",
          ...(input.clientSecret?.trim()
            ? { clientSecret: input.clientSecret }
            : {}),
          discoveryUrl: input.discoveryUrl ?? "",
          authorizationUrl: input.authorizationUrl ?? "",
          tokenUrl: input.tokenUrl ?? "",
          userInfoUrl: input.userInfoUrl ?? "",
          scopes: input.scopes ?? "",
        };
  try {
    await callAction(await context(), "sso.updateConnection", {
      id: input.id,
      displayName: input.displayName,
      emailDomains: input.emailDomains,
      enforce: input.enforce,
      ...protocol,
    });
  } catch (error) {
    return refusal(error, "sso.updateConnection");
  }
  return saved();
}

/** Turns a connection off, or on again. */
export async function setSSOConnectionEnabledAction(
  id: string,
  enabled: boolean,
): Promise<SSOWriteResult> {
  try {
    await callAction(await context(), "sso.setConnectionEnabled", {
      id,
      enabled,
    });
  } catch (error) {
    return refusal(error, "sso.setConnectionEnabled");
  }
  return saved();
}

/** Removes a connection. The screen has already asked. */
export async function removeSSOConnectionAction(
  id: string,
): Promise<SSOWriteResult> {
  try {
    await callAction(await context(), "sso.removeConnection", { id });
  } catch (error) {
    return refusal(error, "sso.removeConnection");
  }
  return saved();
}
