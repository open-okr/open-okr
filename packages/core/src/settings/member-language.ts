import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";

export type MemberLanguage = "en" | "ms";

const shipped = (value: unknown): value is MemberLanguage =>
  value === "en" || value === "ms";

/** The signed-in interface and the copilot use the same language preference. */
export async function resolveMemberLanguage(
  context: Pick<ActionCallContext, "pool" | "workspaceId" | "actor">,
  memberId: string,
): Promise<MemberLanguage> {
  try {
    const member = await callAction(context, "people.readMember", { memberId });
    if (shipped(member.language)) {
      return member.language;
    }
    const { workspace } = await callAction(context, "workspace.overview", {});
    return shipped(workspace.language) ? workspace.language : "en";
  } catch {
    return "en";
  }
}
