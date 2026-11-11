"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useActionState } from "react";
import type { AdoptState } from "./workspace-actions";

/**
 * The workspaces S-45 does not list yet, and Adopt now (Q-9, plan 0.8.1).
 *
 * Turning the cloud flag on after workspaces exist read "0 tenants" until the
 * hourly adopt ran, with nothing to say why. This says how many wait and
 * adopts them on the spot.
 *
 * **Drawn in the same place whether anything waits or not**, so the answer
 * outlives the press: adopting revalidates the page, the count drops to zero,
 * and a component that unmounted at zero would take "Adopted 3 workspaces"
 * with it. With nothing waiting and nothing pressed it draws nothing.
 */
export function AdoptWaiting({
  count,
  action,
}: {
  /** Live workspaces with no tenant record. */
  readonly count: number;
  readonly action: () => Promise<AdoptState>;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: AdoptState | null) => action(),
    null,
  );

  if (state?.done && count === 0) {
    return (
      <p
        className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm"
        role="status"
        data-testid="adoption-result"
      >
        {state.done}
      </p>
    );
  }
  if (count === 0) {
    return null;
  }

  return (
    <section
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border-y border-r border-l-4 border-info-dot bg-info-bg px-4 py-3 text-info text-sm"
      data-testid="adoption-waiting"
    >
      <p className="min-w-0 flex-1">
        {count === 1
          ? t("operator.workspaces.waitingOne")
          : t("operator.workspaces.waitingOther", { count })}
      </p>
      <form action={formAction} aria-busy={pending}>
        <Button type="submit" variant="primary">
          {t("operator.workspaces.adoptNow")}
        </Button>
      </form>
      {/* Pressed, and still some waiting: one made since the press. */}
      {state?.done ? (
        <p className="w-full" role="status">
          {state.done}
        </p>
      ) : null}
      {state?.error ? (
        <p
          className="w-full rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
