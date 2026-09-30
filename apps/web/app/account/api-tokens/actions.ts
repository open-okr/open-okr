"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import type { TokenResult } from "./token-state.ts";

/**
 * A member's own token writes (P5-T07a).
 *
 * Both actions resolve the member from the session and take no member id, so
 * there is no identifier a caller could pass to mint or revoke on somebody
 * else's behalf.
 */
async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

const SCOPES = ["read", "write", "destructive"] as const;
type Scope = (typeof SCOPES)[number];

/**
 * Mints a token and hands it back once.
 *
 * The response is the only place the raw value exists. A member who loses it
 * mints another and revokes this one, which is the honest answer: there is no
 * way to show it again and pretending otherwise would mean storing it.
 */
export async function createToken(
  _previous: TokenResult | null,
  form: FormData,
): Promise<TokenResult> {
  const { t } = await getTranslations();
  const name = String(form.get("name") ?? "").trim();
  // Anything but the agent audience is a REST token, the default a script
  // expects. The action's own schema refuses anything else as well.
  const audience = form.get("audience") === "mcp" ? "mcp" : "rest";
  const scopes = SCOPES.filter((scope) => form.get(`scope.${scope}`) === "on");
  const days = String(form.get("expiresInDays") ?? "").trim();

  if (name === "") {
    return {
      ok: false,
      token: null,
      message: t("account.apiTokens.actions.giveTheTokenAName"),
    };
  }
  if (scopes.length === 0) {
    return {
      ok: false,
      token: null,
      message: t("account.apiTokens.actions.chooseAtLeastOneScope"),
    };
  }

  try {
    const created = await callAction(await context(), "tokens.create", {
      name,
      audience,
      scopes: scopes as Scope[],
      expiresInDays: days === "" ? null : Number(days),
    });
    revalidatePath("/account/api-tokens");
    return {
      ok: true,
      token: created.token,
      audience,
      message:
        audience === "mcp"
          ? t("account.apiTokens.pasteIntoYourAgent")
          : t("admin.invitations.inviteForm.copyThisNowIt"),
    };
  } catch (error) {
    return {
      ok: false,
      token: null,
      message:
        error instanceof Error
          ? error.message
          : t("account.apiTokens.actions.thatDidNotWork"),
    };
  }
}

export async function revokeToken(
  _previous: TokenResult | null,
  form: FormData,
): Promise<TokenResult> {
  const { t } = await getTranslations();
  const id = String(form.get("id") ?? "");
  try {
    await callAction(await context(), "tokens.revoke", { id });
  } catch (error) {
    return {
      ok: false,
      token: null,
      message:
        error instanceof Error
          ? error.message
          : t("account.apiTokens.actions.thatDidNotWork"),
    };
  }
  // The revoked stamp on the row is the durable confirmation, so the page
  // reload carries it rather than a message that a revalidation would unmount.
  revalidatePath("/account/api-tokens");
  return { ok: true, token: null, message: "" };
}
