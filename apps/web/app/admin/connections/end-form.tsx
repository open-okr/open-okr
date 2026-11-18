"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  NOTHING_YET,
  type RevokeResult,
} from "../../account/connections/revoke-state.ts";

/**
 * Ending one connection on Admin, Agent connections. It asks first (D10),
 * because the member's agent stops at once and only they can connect it
 * again. The question is on the page rather than in a browser dialog, so it
 * is reached from the keyboard like the rest of the row.
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
  const [asking, setAsking] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const questionId = `end-${kind}-${id}-question`;

  useEffect(() => {
    if (asking) {
      confirmRef.current?.focus();
    }
  }, [asking]);

  // A refusal closes the question so the message shows under the row button.
  useEffect(() => {
    if (!state.ok) {
      setAsking(false);
    }
  }, [state]);

  if (asking) {
    return (
      <form action={formAction} aria-busy={pending} className="w-full">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <fieldset
          aria-labelledby={questionId}
          className="flex min-w-0 flex-col gap-2 rounded-control border border-line-2 bg-raised p-3"
          data-testid={`end-${kind}-${id}-confirm`}
        >
          <p id={questionId} className="text-sm font-medium text-ink">
            {t("admin.connections.confirmEnd", { member: memberName, label })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmRef}
              type="submit"
              size="sm"
              variant="primary"
              pending={pending}
            >
              {t("admin.connections.endConnection")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setAsking(false);
                openRef.current?.focus();
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </fieldset>
      </form>
    );
  }
  return (
    <div className="w-fit">
      <Button
        ref={openRef}
        type="button"
        size="sm"
        onClick={() => setAsking(true)}
      >
        {t("admin.connections.end")}
      </Button>
      {state.ok ? null : (
        <p role="alert" className="mt-1.5 text-xs text-bad">
          {state.message}
        </p>
      )}
    </div>
  );
}
