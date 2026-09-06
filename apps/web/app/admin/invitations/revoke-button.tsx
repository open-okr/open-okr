"use client";

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
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            "Revoke this invitation? Nobody else can use it. People who already joined through it stay members.",
          )
        ) {
          return;
        }
        start(() => {
          void revokeLinkAction(linkId);
        });
      }}
      className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 disabled:opacity-60"
    >
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}
