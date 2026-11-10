"use client";

import { Button, useTranslations } from "@openokr/ui";
import { type FormEvent, useActionState } from "react";
import {
  NOTHING_YET,
  type RevokeResult,
} from "../../account/connections/revoke-state.ts";

/**
 * Ending one connection on Admin, Agent connections. It asks first (D10),
 * because the member's agent stops at once and only they can connect it
 * again.
 */
export function EndConnectionForm({
  action,
  kind,
  id,
  memberName,
  label,
}: {
  readonly action: (
    previous: RevokeResult | null,
    formData: FormData,
  ) => Promise<RevokeResult>;
  readonly kind: "grant" | "token";
  readonly id: string;
  readonly memberName: string;
  readonly label: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  const ask = (event: FormEvent<HTMLFormElement>) => {
    if (
      !window.confirm(
        t("admin.connections.confirmEnd", { member: memberName, label }),
      )
    ) {
      event.preventDefault();
    }
  };
  return (
    <form
      action={formAction}
      onSubmit={ask}
      className="w-fit"
      aria-busy={pending}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" disabled={pending}>
        {t("admin.connections.end")}
      </Button>
      {state.ok ? null : (
        <p role="alert" className="mt-1.5 text-xs text-bad">
          {state.message}
        </p>
      )}
    </form>
  );
}
