"use server";

import { callAction } from "@openokr/core";
import type { EntityOption } from "@openokr/ui";
import { memberOption } from "./entity-options";
import { getPool } from "./pool";
import { refusalOf } from "./refusal";
import { getTranslations } from "./translations";
import { requireWorkspace } from "./workspace";

type MemberKind = "human" | "guest" | "agent" | "placeholder";

/**
 * The members whose name or title holds what was typed, for a picker over
 * more members than the browser filters (guided-inputs §4.10). Through
 * `people.directory`, so the picker is shown exactly who the directory would
 * show this reader.
 *
 * `kinds` narrows it where the contract does: a champion is a person, never
 * an agent. Nothing comes back for a refused search, so a picker never
 * breaks a screen over one.
 */
export async function searchMembers(
  text: string,
  kinds?: readonly MemberKind[],
): Promise<EntityOption[]> {
  const typed = text.trim();
  if (typed === "") {
    return [];
  }
  const { session, workspace } = await requireWorkspace();
  const { t } = await getTranslations();
  try {
    const found = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "people.directory",
      {
        search: typed.slice(0, 200),
        ...(kinds ? { kinds: [...kinds] } : {}),
        limit: 20,
      },
    );
    return found.map((member) => memberOption(member, t("common.agent")));
  } catch (error) {
    if (refusalOf(error) === null) {
      throw error;
    }
    return [];
  }
}

/**
 * People only, for a server page to hand straight to a picker: a server
 * action passes into a client component where a closure cannot. A champion,
 * an owner, a sponsor and a facilitator are people (H-09).
 */
export async function searchPeople(text: string): Promise<EntityOption[]> {
  return searchMembers(text, ["human", "guest"]);
}

/** Every active member, agents among them, badged, for the lists that offered them. */
export async function searchAnyone(text: string): Promise<EntityOption[]> {
  return searchMembers(text);
}

/** People with an account here and no guests, for an initiative's owner. */
export async function searchHumans(text: string): Promise<EntityOption[]> {
  return searchMembers(text, ["human"]);
}
