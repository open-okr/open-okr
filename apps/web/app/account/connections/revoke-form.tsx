"use client";

import { Button } from "@openokr/ui";
import { useActionState } from "react";
import { NOTHING_YET, type RevokeResult } from "./revoke-state.ts";

/**
 * Ending one connection (P5-T08c).
 *
 * Only a failure renders anything. Success is the list coming back with the row
 * marked revoked, which is a better confirmation than a sentence beside a button
 * that is no longer there.
 */
export function RevokeForm({
  action,
  id,
}: {
  readonly action: (
    previous: RevokeResult | null,
    formData: FormData,
  ) => Promise<RevokeResult>;
  readonly id: string;
}) {
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  return (
    <form action={formAction} className="w-fit" aria-busy={pending}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm">
        Revoke
      </Button>
      {state.ok ? null : (
        <p role="alert" className="mt-1.5 text-xs text-bad">
          {state.message}
        </p>
      )}
    </form>
  );
}
