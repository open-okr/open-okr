"use client";

import { Avatar, AvatarStack, useTranslations } from "@openokr/ui";

/**
 * Who else has this board open (UIUX-PLAN §3 "Presence", completeness review
 * M-02).
 *
 * UIUX-PLAN puts a realtime avatar stack on the board, and P5-T11 listed it.
 * The names arrive from the board's stream, already filtered on the server to
 * members who can read this board, so nothing here decides who may be shown.
 *
 * **Nothing at all when nobody else is here**, and nothing when realtime is
 * unavailable: an empty stack, or a sentence saying "only you", would be
 * furniture on every board of a workspace that is mostly one person at a time.
 *
 * **Read by ear as one sentence.** The avatars are hidden from assistive
 * technology and the sentence beside them is not, so a screen reader hears
 * "Also looking at this board: Ada Lovelace and Grace Hopper" rather than a
 * run of initials.
 */

export interface PresentMember {
  readonly id: string;
  readonly name: string;
}

/** Faces drawn before the rest become a count. */
const SHOWN = 5;

export function BoardPresence({
  members,
}: {
  readonly members: readonly PresentMember[];
}) {
  const { t, locale } = useTranslations();
  if (members.length === 0) {
    return null;
  }

  const names = new Intl.ListFormat(locale === "pseudo" ? "en" : locale, {
    type: "conjunction",
  }).format(members.map((member) => member.name));
  const label = t("board.presence.alsoHere", { names });
  const shown = members.slice(0, SHOWN);
  const more = members.length - shown.length;

  return (
    <div
      data-testid="board-presence"
      title={label}
      className="flex items-center gap-1.5"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        <AvatarStack>
          {shown.map((member) => (
            <Avatar key={member.id} name={member.name} size="sm" />
          ))}
        </AvatarStack>
        {more > 0 ? <span className="text-xs text-ink-3">+{more}</span> : null}
      </span>
    </div>
  );
}
