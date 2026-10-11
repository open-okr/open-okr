import type { EntityOption } from "@openokr/ui";

/**
 * The picker's options, made the same way on every screen (guided-inputs
 * §4.10). Plain functions rather than a client module, so a server page and a
 * client component build a member's option identically.
 */

/** What any member read gives back: the directory's, a participant's. */
export interface MemberLike {
  readonly id: string;
  readonly name: string;
  readonly title?: string | null;
  readonly kind?: string;
}

/**
 * A member: their initials avatar, their name, their title, and the word for
 * an agent where it is one, so an agent is never mistaken for a person.
 */
export function memberOption(
  member: MemberLike,
  agentLabel: string,
): EntityOption {
  return {
    id: member.id,
    label: member.name,
    detail: member.title ?? null,
    avatar: true,
    badge: member.kind === "agent" ? agentLabel : null,
  };
}

/** A space, a cycle, a goal: something with a name and nothing to add to it. */
export function namedOption(row: {
  readonly id: string;
  readonly name: string;
}): EntityOption {
  return { id: row.id, label: row.name };
}
