"use client";

/**
 * The Coach on the goal page (METHOD.md §4, P4-T06c).
 *
 * The quality panel on the cycle screen judges a goal while it is being
 * drafted. This is the same verdict where the goal actually lives afterwards,
 * because a rule nobody sees again is a rule nobody fixes: a goal is written
 * once and read all quarter.
 *
 * **Stored verdicts, not a fresh evaluation.** P4-T02a writes the score and the
 * flags inside the transaction that changed the text, so this shows what the
 * product committed to. Re-evaluating here could put two different answers on
 * one screen.
 *
 * **With no provider the assist explains rather than disappearing.** A control
 * that vanished would leave a writer wondering whether the product had one; the
 * strip says the rules still apply and only the suggestion needs a provider.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { applyRewrite, rewriteKeyResultAction } from "./actions";

export interface CoachStripKeyResult {
  readonly id: string;
  readonly title: string;
  readonly qualityFlags: readonly string[];
}

interface Suggestion {
  readonly keyResultId: string;
  readonly ruleId: string;
  readonly text: string;
  readonly nowPassing: readonly string[];
  readonly fixesTheRule: boolean;
}

export function CoachStrip({
  goalId,
  score,
  flags,
  keyResults,
  drafting,
  canEdit,
}: {
  readonly goalId: string;
  readonly score: number | null;
  readonly flags: readonly string[];
  readonly keyResults: readonly CoachStripKeyResult[];
  readonly drafting: boolean;
  readonly canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const ask = useCallback((keyResultId: string, ruleId: string) => {
    setProblem(null);
    setSuggestion(null);
    startTransition(async () => {
      try {
        const result = await rewriteKeyResultAction(keyResultId, ruleId);
        if (!result) {
          setProblem(
            "No suggestion came back. The provider may be off, or the model had nothing usable to say.",
          );
          return;
        }
        setSuggestion({ keyResultId, ruleId, ...result });
      } catch {
        setProblem("The assist could not be reached.");
      }
    });
  }, []);

  const apply = useCallback(
    (chosen: Suggestion) => {
      setProblem(null);
      startTransition(async () => {
        const result = await applyRewrite(
          goalId,
          chosen.keyResultId,
          chosen.text,
        );
        if (result.error) {
          setProblem(result.error);
          return;
        }
        // The page revalidates, so the strip re-renders from the stored
        // verdict. Clearing the suggestion here stops a stale preview sitting
        // beside a flag that has already gone.
        setSuggestion(null);
      });
    },
    [goalId],
  );

  const failing = keyResults.filter((kr) => kr.qualityFlags.length > 0);

  if (flags.length === 0 && failing.length === 0) {
    return null;
  }

  return (
    // Named, so it is a landmark a screen reader can jump to and a test can
    // scope to. A card with no accessible name is a div.
    <Card role="region" aria-labelledby="coach-strip-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2 id="coach-strip-heading" className="text-sm font-bold text-ink">
            What the Coach sees
          </h2>
          {score === null ? null : (
            <Chip tone={score >= 75 ? "ok" : score < 45 ? "bad" : "warn"}>
              {Math.round(score)}%
            </Chip>
          )}
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {flags.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-3">
              This objective
            </span>
            <span className="flex flex-wrap gap-1.5">
              {flags.map((rule) => (
                // Every verdict links to the rule, so a writer can read it and
                // disagree with it rather than guessing what it wants.
                <Link key={rule} href={`/method/${rule}`}>
                  <Chip tone="warn">{rule}</Chip>
                </Link>
              ))}
            </span>
          </div>
        )}

        {failing.map((kr) => (
          <div key={kr.id} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-3">{kr.title}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              {kr.qualityFlags.map((rule) => (
                <span key={rule} className="flex items-center gap-1">
                  <Link href={`/method/${rule}`}>
                    <Chip tone="warn">{rule}</Chip>
                  </Link>
                  {/* The assist is an `edit` action, so offering it to a
                      reader would produce a refusal rather than a suggestion. */}
                  {drafting && canEdit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => ask(kr.id, rule)}
                    >
                      Suggest a fix
                    </Button>
                  ) : null}
                </span>
              ))}
            </span>
          </div>
        ))}

        {drafting ? null : (
          <p className="text-xs text-ink-4">
            The rules above are checked with or without an AI provider. A
            suggested rewrite needs one, and none is configured.
          </p>
        )}

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}

        {suggestion === null ? null : (
          <div className="flex flex-col gap-1.5 rounded-md border border-line bg-raised p-2">
            <span className="text-xs font-medium text-ink-3">
              Suggested for {suggestion.ruleId}
            </span>
            <span className="text-sm text-ink">{suggestion.text}</span>
            {suggestion.fixesTheRule ? (
              <span className="text-xs text-ok">
                Checked against the catalogue: this now passes{" "}
                {suggestion.nowPassing.join(", ")}.
              </span>
            ) : (
              // The model's claim is not the product's claim. §4 was run over
              // the suggestion and disagreed, and saying so is the honest
              // outcome rather than presenting it as a fix.
              <span className="text-xs text-warn">
                Checked against the catalogue: this still does not satisfy{" "}
                {suggestion.ruleId}. Use it as a starting point if it helps.
              </span>
            )}
            {canEdit ? (
              <span className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => apply(suggestion)}
                >
                  Use this wording
                </Button>
                <span className="text-xs text-ink-4">
                  Nothing is saved until you press it.
                </span>
              </span>
            ) : (
              <span className="text-xs text-ink-4">
                Nothing has been saved, and this goal is not yours to edit.
              </span>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
