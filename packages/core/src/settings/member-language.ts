import {
  activeOnly,
  type WorkspaceTx,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import {
  isShippedLocale,
  LOCALES,
  type LocaleCode,
  languageName,
} from "@openokr/formats";
import { eq } from "drizzle-orm";
import type { ActionCallContext } from "../actions/define.ts";
import { resolveInstanceDefaultLanguage } from "./workspace-defaults.ts";

export type MemberLanguage = LocaleCode;
export { LOCALES, type LocaleCode, languageName };

/** The signed-in interface and the copilot use the same language preference. */
export async function resolveMemberLanguage(
  context: Pick<ActionCallContext, "pool" | "workspaceId" | "actor">,
  memberId = context.actor.memberId,
): Promise<LocaleCode> {
  // Writing assists in the registry also call this resolver. Load the action
  // gateway on use so its definitions finish initialising first.
  const { callAction } = await import("../actions/registry.ts");
  const memberPreference = async (
    id: string,
  ): Promise<LocaleCode | undefined> => {
    const member = await callAction(context, "people.readMember", {
      memberId: id,
    }).catch(() => null);
    return isShippedLocale(member?.language) ? member.language : undefined;
  };
  if (memberId) {
    const language = await memberPreference(memberId);
    if (language) return language;
  }

  try {
    const { workspace, member } = await callAction(
      context,
      "workspace.overview",
      {},
    );
    if (!memberId) {
      const language = await memberPreference(member.id);
      if (language) return language;
    }
    if (workspace?.language && isShippedLocale(workspace.language)) {
      return workspace.language;
    }
  } catch {
    // workspace overview failed
  }

  try {
    const instance = await resolveInstanceDefaultLanguage(context.pool);
    if (isShippedLocale(instance)) {
      return instance;
    }
  } catch {
    // instance setting unreadable
  }

  return "en";
}

/** A drafting sweep already runs under its workspace's transaction. */
export async function resolveDraftLanguageInTx(
  tx: WorkspaceTx,
  workspaceId: string,
  recipientMemberId?: string | null,
): Promise<LocaleCode> {
  if (recipientMemberId) {
    const [recipient] = await tx
      .select({ language: workspaceMembers.language })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.id, recipientMemberId),
          eq(workspaceMembers.status, "active"),
        ),
      )
      .limit(1);
    if (isShippedLocale(recipient?.language)) return recipient.language;
  }

  const [workspace] = await tx
    .select({ settings: workspaces.settings })
    // openokr:allow-raw-read: the sweep reads its own workspace's language, a
    // setting the access getter does not return.
    .from(workspaces)
    .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
    .limit(1);
  const language = (
    workspace?.settings as { readonly language?: unknown } | null
  )?.language;
  if (isShippedLocale(language)) return language;
  const instance = await resolveInstanceDefaultLanguage(tx);
  return isShippedLocale(instance) ? instance : "en";
}
