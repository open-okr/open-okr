"use client";

import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { applyProposalsAction, dismissProposalsAction } from "./actions";

/**
 * The proposal review queue (AI-NATIVE-PLAN.md §6.5, screen S-38, P6-G13a).
 *
 * **The missing half of a hard rule.** CLAUDE.md: "Propose by default. Agents
 * produce proposals into the review queue." `proposals.list`, `bulkApply` and
 * `bulkDismiss` all shipped at P2-T17 and no screen ever reached them, so an
 * agent in the default write policy could produce a proposal that nobody could
 * see, let alone act on. An agent whose proposals nobody reads is an agent that
 * has not spoken. The gap audit of 7 September 2026 recorded it as G-05.
 *
 * **What would change, in the caller's own words.** A proposal is an action
 * name and a payload, so the row shows both: the action tells a reviewer what
 * kind of change it is and the payload is the change itself. Rendering it as
 * prose would mean a second description of every action in the registry, and
 * one of the two would go stale.
 *
 * **Bulk, and the answer is per proposal.** `bulkApply` reports what applied
 * and what refused with a reason each, because applying ten proposals where the
 * third is stale must not abandon the other nine. The refusals stay on screen
 * after the successes disappear, which is the only arrangement where a reviewer
 * learns what happened.
 *
 * **Nothing is preselected.** Applying an agent's proposal is a write through
 * the Operation pipeline in the reviewer's own name, and a queue that arrives
 * with everything ticked is the automatic approval the propose-by-default rule
 * exists to prevent.
 */

export interface QueuedProposal {
  readonly id: string;
  /** Null for a copilot proposal, which belongs to its thread and not here. */
  readonly runId: string | null;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
}

/** A payload as a reviewer can read it, without a renderer per action. */
function describe(payload: Record<string, unknown>): string {
  const parts = Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => {
      const rendered =
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : // An object or an array is summarised rather than dumped: a
              // reviewer needs to know something is there, and the run log is
              // where the whole thing lives.
              Array.isArray(value)
              ? `${value.length} items`
              : "an object";
      return `${key}: ${rendered}`;
    });
  return parts.length === 0 ? "no fields" : parts.join(" · ");
}

export function ProposalQueue({
  proposals,
}: {
  readonly proposals: readonly QueuedProposal[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<
    readonly { id: string; error: string }[]
  >([]);

  const toggle = useCallback((id: string) => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const run = useCallback(
    (task: () => Promise<string>) => {
      setOutcome(null);
      setRefusals([]);
      startTransition(async () => {
        try {
          setOutcome(await task());
          setChosen(new Set());
          router.refresh();
        } catch (error) {
          setOutcome(
            error instanceof Error ? error.message : "Something went wrong.",
          );
        }
      });
    },
    [router],
  );

  const ids = [...chosen];

  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">Proposals waiting</h2>
          <p className="text-xs text-ink-3">
            An agent in the default write policy changes nothing until somebody
            here says so. Applying one is a write in your name, audited to both
            of you.
          </p>
        </div>
        <Chip tone={proposals.length > 0 ? "warn" : "ok"}>
          {proposals.length} pending
        </Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {proposals.length === 0 ? (
          <p className="text-sm text-ink-3">
            Nothing waiting. An agent proposes when it has something to say and
            the write policy stops it acting alone; an empty queue means it has
            nothing, not that it is off.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {proposals.map((proposal) => (
                <li
                  key={proposal.id}
                  className="flex items-start gap-2.5 border-line border-b pb-2 last:border-0 last:pb-0"
                >
                  <input
                    type="checkbox"
                    id={`proposal-${proposal.id}`}
                    checked={chosen.has(proposal.id)}
                    onChange={() => toggle(proposal.id)}
                    className="mt-1"
                  />
                  <label
                    htmlFor={`proposal-${proposal.id}`}
                    className="flex min-w-0 flex-1 flex-col gap-0.5"
                  >
                    <span className="font-mono text-xs text-brand-text">
                      {proposal.action}
                    </span>
                    <span className="text-sm text-ink">
                      {describe(proposal.payload)}
                    </span>
                    <span className="text-xs text-ink-4">
                      {proposal.subjectType
                        ? `on a ${proposal.subjectType.replace(/_/g, " ")}`
                        : "workspace-wide"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={pending || ids.length === 0}
                onClick={() =>
                  run(async () => {
                    const result = await applyProposalsAction(ids);
                    setRefusals(result.failed);
                    return `Applied ${result.applied} of ${ids.length}.`;
                  })
                }
              >
                Apply {ids.length > 0 ? ids.length : ""}
              </Button>
              <Button
                disabled={pending || ids.length === 0}
                onClick={() =>
                  run(async () => {
                    const result = await dismissProposalsAction(ids);
                    return `Dismissed ${result.dismissed}.`;
                  })
                }
              >
                Dismiss
              </Button>
              <span className="text-xs text-ink-4">
                Nothing is chosen for you. A queue that arrives ticked is the
                automatic approval this policy exists to prevent.
              </span>
            </div>
          </>
        )}

        {outcome ? (
          <p role="status" className="text-xs text-ink-2">
            {outcome}
          </p>
        ) : null}

        {refusals.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-md bg-bad-bg px-2.5 py-2">
            {refusals.map((refusal) => (
              <li key={refusal.id} className="text-xs text-bad">
                {refusal.error}
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}
