import {
  isShippedLocale,
  type LocaleCode,
  languageName,
} from "@openokr/formats";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import { resolveInstanceDefaultLanguage } from "./workspace-defaults.ts";

export type MemberLanguage = LocaleCode;
export { languageName };

/** The signed-in interface and the copilot use the same language preference. */
export async function resolveMemberLanguage(
  context: Pick<ActionCallContext, "pool" | "workspaceId" | "actor">,
  memberId: string,
): Promise<LocaleCode> {
  try {
    const member = await callAction(context, "people.readMember", { memberId });
    if (member?.language && isShippedLocale(member.language)) {
      return member.language;
    }
  } catch {
    // member not found or action failed
  }

  try {
    const { workspace } = await callAction(context, "workspace.overview", {});
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
