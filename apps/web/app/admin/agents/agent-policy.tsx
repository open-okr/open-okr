"use client";

import { Button } from "@openokr/ui";
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

/** §6's three policies, in the order they widen. */
const POLICY: Record<string, { label: string; means: string }> = {
  sandbox: {
    label: "Sandbox",
    means: "runs and records, commits nothing at all",
  },
  propose: {
    label: "Propose",
    means: "writes proposals into the review queue for somebody to approve",
  },
  scoped_direct: {
    label: "Scoped direct",
    means:
      "writes directly, but only inside the scopes bound below. Nothing else",
  },
};

/** What an agent can be bound to. The workspace is deliberately absent. */
const BINDABLE = [
  { type: "space", label: "Space" },
  { type: "goal", label: "Goal" },
  { type: "kpi_tree", label: "KPI tree" },
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
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Write policy
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
                      `Let ${name} write directly? It will commit inside the scopes bound to it without anybody approving each change. Everything it writes is still audited, and it can be moved back at any time.`,
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
            What
            <select
              name="resourceType"
              className="rounded-md border border-line bg-bg px-2 py-1 text-sm text-ink"
            >
              {BINDABLE.map((one) => (
                <option key={one.type} value={one.type}>
                  {one.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-ink-3">
            Its id
            <input
              name="resourceId"
              placeholder="paste the id from its own page"
              className="w-80 rounded-md border border-line bg-bg px-2 py-1 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-xs text-ink-3">
            Level
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
            {pending ? "Binding…" : "Bind"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Cancel
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
          Bind a scope
        </Button>
      )}

      <span className="text-xs text-ink-4">
        An agent is bound to named spaces, goals and KPI trees. The workspace is
        not on this list and the action refuses it: there is no service account
        with authority over everything.
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
