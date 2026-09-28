"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useState, useTransition } from "react";
import { bindAgentScopeAction, setAgentAutonomyAction } from "./actions";

/**
 * An agent's write policy and its scope (S-38, P6-G13b, GAP-AUDIT G-05).
 *
 * **`agents.create` took an autonomy and nothing could change it.** The column
 * has held the three policies since P4-T05a, and moving an agent between them
 * needed a database session, so the propose-and-approve default was in
 * practice permanent and the sandbox a one-way door. `agents.setAutonomy` is
 * new with this.
 *
 * **What each policy does is written beside it**, rather than three words to
 * guess between. "Scoped direct" is the one that writes without asking, and a
 * screen that offers it as a bare label is a screen that gets it chosen by
 * accident.
 *
 * **The workspace is not in the picker, and the action refuses it too.**
 * CLAUDE.md's rule is that an agent gets bindings on named spaces, goals and
 * KPI trees only and that there is no service account with ambient authority.
 * `agents.bindScope` said "never workspace-wide" in its own summary from
 * P4-T05a and enforced nothing; both halves are here now, because an interface
 * that merely omits an option is not an authorisation. P6-G13b wrote them and
 * had to withdraw them, because the access floor left an agent bound to a
 * space unable to write; P6-G13c fixed the floor and they are back.
 *
 * **The policy list and the access levels arrive as props.** Importing
 * `AGENT_AUTONOMIES` from `@openokr/db` and `ACCESS_LEVELS` from
 * `@openokr/core` put the database layer into a client bundle and the build
 * failed on `dns` and `fs`. Every other client component in this app imports
 * types from those packages and never values, which is the rule; the page is
 * a server component and passes what it already holds.
 */

/**
 * §6's three policies, in the order they widen. A function of `t` so the
 * wording comes from the catalogue in the reader's language.
 */
function policies(
  t: (key: string) => string,
): Record<string, { label: string; means: string }> {
  return {
    sandbox: {
      label: t("admin.agents.agentPolicy.sandbox"),
      means: t("admin.agents.agentPolicy.sandboxMeans"),
    },
    propose: {
      label: t("admin.agents.agentPolicy.propose"),
      means: t("admin.agents.agentPolicy.proposeMeans"),
    },
    scoped_direct: {
      label: t("admin.agents.agentPolicy.scopedDirect"),
      means: t("admin.agents.agentPolicy.scopedDirectMeans"),
    },
  };
}

/** What an agent can be bound to. The workspace is deliberately absent. */
const BINDABLE = [
  { type: "space", labelKey: "initiatives.space" },
  { type: "goal", labelKey: "admin.agents.agentPolicy.goal" },
  { type: "kpi_tree", labelKey: "admin.agents.agentPolicy.kpiTree" },
] as const;

export function AgentPolicy({
  agentId,
  autonomy,
  name,
  autonomies,
  levels,
}: {
  readonly agentId: string;
  readonly autonomy: string;
  readonly name: string;
  /** Every policy the column can hold, from the table. */
  readonly autonomies: readonly string[];
  /** The four access levels, from the canon's own map. */
  readonly levels: readonly {
    readonly value: number;
    readonly label: string;
  }[];
}) {
  const { t } = useTranslations();
  const POLICY = policies(t);

  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          {t("admin.agents.agentPolicy.writePolicy")}
        </span>
        <div className="flex flex-wrap gap-2">
          {autonomies.map((option) => {
            const current = option === autonomy;
            const meaning = POLICY[option];
            return (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={current ? "primary" : "default"}
                disabled={pending || current}
                data-testid={`autonomy-${option}`}
                onClick={() => {
                  if (
                    option === "scoped_direct" &&
                    !window.confirm(
                      t("admin.agents.agentPolicy.confirmScopedDirect", {
                        name,
                      }),
                    )
                  ) {
                    return;
                  }
                  setProblem(null);
                  start(async () => {
                    const result = await setAgentAutonomyAction(
                      agentId,
                      option as "sandbox" | "propose" | "scoped_direct",
                    );
                    setProblem(result.error);
                  });
                }}
              >
                {meaning?.label ?? option}
              </Button>
            );
          })}
        </div>
        <span className="text-xs text-ink-3">
          {POLICY[autonomy]?.means ?? autonomy}
        </span>
      </div>

      {open ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setProblem(null);
            start(async () => {
              const result = await bindAgentScopeAction({
                agentId,
                resourceType: String(form.get("resourceType") ?? ""),
                resourceId: String(form.get("resourceId") ?? "").trim(),
                level: Number(form.get("level")),
              });
              setProblem(result.error);
              if (!result.error) {
                setOpen(false);
              }
            });
          }}
        >
          <label className="flex flex-col gap-0.5 text-xs text-ink-3">
            {t("admin.agents.agentPolicy.what")}
            <select
              name="resourceType"
              className="rounded-md border border-line bg-bg px-2 py-1 text-sm text-ink"
            >
              {BINDABLE.map((one) => (
                <option key={one.type} value={one.type}>
                  {t(one.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-ink-3">
            {t("admin.agents.agentPolicy.itsId")}
            <input
              name="resourceId"
              placeholder={t("admin.agents.agentPolicy.pasteTheIdFrom")}
              className="w-80 rounded-md border border-line bg-bg px-2 py-1 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-ink-3">
            {t("common.level")}
            <select
              name="level"
              defaultValue={String(levels[2]?.value ?? 70)}
              className="rounded-md border border-line bg-bg px-2 py-1 text-sm text-ink"
            >
              {levels.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            {pending
              ? t("admin.agents.agentPolicy.binding")
              : t("admin.agents.agentPolicy.bind")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            {t("common.cancel")}
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="default"
          className="self-start"
          onClick={() => setOpen(true)}
        >
          {t("admin.agents.agentPolicy.bindAScope")}
        </Button>
      )}

      <span className="text-xs text-ink-4">
        {t("admin.agents.agentPolicy.anAgentIsBound")}
      </span>

      {problem ? (
        <span
          role="alert"
          data-testid="agent-policy-error"
          className="text-xs text-bad"
        >
          {problem}
        </span>
      ) : null}
    </div>
  );
}
