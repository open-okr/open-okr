"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useTransition } from "react";
import { revokeLinkAction } from "./actions";

/**
 * Revoking one invitation (P6-G06).
 *
 * A client component because it needs a pending state and a confirmation, and
 * because a form per row inside a list is a lot of markup for one button.
 *
 * **The confirmation names what does not happen.** Revoking a link stops
 * anybody else using it and changes nothing about the people who already
 * joined through it, which is the thing an administrator is actually worried
 * about when they click.
 */
export function RevokeButton({ linkId }: { readonly linkId: string }) {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      pending={pending}
      onClick={() => {
        if (!window.confirm(t("admin.invitations.revokeButton.confirm"))) {
          return;
        }
        // Awaited, so the transition lasts as long as the revoke and the label
        // says "Revoking" until the server has answered.
        start(async () => {
          await revokeLinkAction(linkId);
        });
      }}
    >
      {pending
        ? t("admin.invitations.revokeButton.revoking")
        : t("common.revoke")}
    </Button>
  );
}
