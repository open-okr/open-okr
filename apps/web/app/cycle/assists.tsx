"use client";

/**
 * The planning and drafting assists on the drafting surface (P4-T15a).
 *
 * **Nothing here is offered when the provider is off.** The parent renders this
 * only when `available` is true, and every action behind it answers null anyway,
 * so a provider-off workspace sees the surface exactly as it was: the same form,
 * the same Draft Coach, the same publish gates. That is the row's acceptance
 * criterion.
 *
 * **A preview, always, and the verdicts beside it.** A draft arrives with the
 * METHOD.md §4 checks it passes and the ones it fails, from the catalogue rather
 * than from the model. So a reader is never shown a confident draft with nothing
 * said about whether it is any good: they see "fails OBJ-2" before they decide.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import {
  alignToParentAction,
  applyDraftedObjectiveAction,
  draftObjectiveAction,
  suggestMeasureAction,
  suggestParentAction,
} from "./assist-actions.ts";

const LEVELS = ["company", "department", "team", "individual"] as const;
type Level = (typeof LEVELS)[number];

interface DraftedMeasure {
  readonly title: string;
  readonly unit: string | null;
  readonly direction: "increase" | "reduce" | "maintain" | "move";
  readonly indicatorType: "leading" | "lagging";
  readonly baseline: number;
  readonly target: number;
  readonly passing: readonly string[];
  readonly failing: readonly string[];
}

interface Drafted {
  readonly title: string;
  readonly description: string;
  readonly keyResults: readonly DraftedMeasure[];
  readonly passing: readonly string[];
  readonly failing: readonly string[];
}

/** The §4 verdicts, as chips a reader can act on. */
function Verdicts({
  passing,
  failing,
}: {
  readonly passing: readonly string[];
  readonly failing: readonly string[];
}) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {failing.map((id) => (
        <Chip key={id} tone="warn">
          {id} fails
        </Chip>
      ))}
      {passing.map((id) => (
        <Chip key={id} tone="ok">
          {id}
        </Chip>
      ))}
    </span>
  );
}

/**
 * Drafts an objective from an ambition, previews it, and applies it on request.
 *
 * The apply is the ordinary `goals.create` plus one `goals.addKeyResult` per
 * measure. A measure the rules refuse is reported by name and the objective
 * stands, because an objective with three of its four measures is a draft
 * somebody can finish and an error page is not.
 */
export function DraftFromAmbition({
  cycleId,
  memberId,
}: {
  readonly cycleId: string;
  /** The reader, who becomes champion and reviewer of what they apply. */
  readonly memberId: string;
}) {
  const [ambition, setAmbition] = useState("");
  const [level, setLevel] = useState<Level>("team");
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const draft = useCallback(async () => {
    if (ambition.trim() === "" || busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await draftObjectiveAction({
        ambition: ambition.trim(),
        cycleId,
        level,
      });
      setDrafted(result);
      if (!result) {
        setNotice("Nothing was drafted from that. Try saying what changes.");
      }
    } catch {
      setNotice("The assist could not run. The form below still works.");
    } finally {
      setBusy(false);
    }
  }, [ambition, busy, cycleId, level]);

  const apply = useCallback(async () => {
    if (!drafted || busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const { refused } = await applyDraftedObjectiveAction({
        cycleId,
        title: drafted.title,
        description: drafted.description,
        level,
        championId: memberId,
        reviewerId: memberId,
        keyResults: drafted.keyResults.map((measure) => ({
          title: measure.title,
          unit: measure.unit,
          direction: measure.direction,
          indicatorType: measure.indicatorType,
          baseline: measure.baseline,
          target: measure.target,
        })),
      });
      setDrafted(null);
      setAmbition("");
      setNotice(
        refused.length === 0
          ? null
          : `The objective is there. These measures were refused: ${refused.join("; ")}`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "That could not be applied.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, cycleId, drafted, level, memberId]);

  return (
    <Card>
      <CardHeader className="justify-between">
        <span className="flex items-center gap-2">
          <Chip tone="agent">
            <Sparkles className="size-3" />
            AI
          </Chip>
          <h2 className="text-sm font-bold text-ink">Draft from an ambition</h2>
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-xs text-ink-3">
          Say what you want to be true by the end of the quarter. Nothing is
          created until you apply it.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-4">The ambition</span>
          <textarea
            rows={2}
            value={ambition}
            disabled={busy}
            onChange={(event) => setAmbition(event.target.value)}
            placeholder="We should be the platform mid-market teams reach for first"
            className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-4"
          />
        </label>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-4">
            Level
            <select
              value={level}
              disabled={busy}
              onChange={(event) => setLevel(event.target.value as Level)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
            >
              {LEVELS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="ai"
            disabled={busy || ambition.trim() === ""}
            onClick={() => void draft()}
          >
            Draft it
          </Button>
        </div>

        {drafted ? (
          <section
            aria-label="Drafted objective"
            className="rounded-lg border border-line bg-surface p-3"
          >
            <p className="text-sm font-semibold text-ink">{drafted.title}</p>
            {drafted.description === "" ? null : (
              <p className="mt-1 text-xs text-ink-3">{drafted.description}</p>
            )}
            <div className="mt-2">
              <Verdicts passing={drafted.passing} failing={drafted.failing} />
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {drafted.keyResults.map((measure) => (
                <li key={measure.title} className="text-xs">
                  <p className="text-ink-2">{measure.title}</p>
                  <p className="text-ink-4">
                    {measure.baseline} to {measure.target}
                    {measure.unit ? ` ${measure.unit}` : ""} ·{" "}
                    {measure.direction} · {measure.indicatorType}
                  </p>
                  <Verdicts
                    passing={measure.passing}
                    failing={measure.failing}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void apply()}
              >
                Apply
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setDrafted(null)}
              >
                Discard
              </Button>
            </div>
          </section>
        ) : null}

        {notice ? <p className="text-xs text-ink-3">{notice}</p> : null}
      </CardBody>
    </Card>
  );
}

/**
 * Suggests the numbers for a key result somebody is part way through writing.
 *
 * **It owns its own field rather than reading the form's.** The suggestion is
 * shown beside the form, never written into it: a reader who has typed a
 * baseline should not have it replaced by a model's guess, and reaching into
 * another component's uncontrolled input to overwrite it is how that happens by
 * accident. They read the numbers, and they type the ones they agree with.
 */
export function SuggestMeasure({ goalId }: { readonly goalId: string }) {
  const [title, setTitle] = useState("");
  const [suggested, setSuggested] = useState<{
    unit: string | null;
    direction: string;
    indicatorType: string;
    baseline: number;
    target: number;
    passing: readonly string[];
    failing: readonly string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (title.trim() === "" || busy) {
      setNotice("Type what is measured first.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await suggestMeasureAction({
        goalId,
        title: title.trim(),
      });
      setSuggested(result);
      if (!result) {
        setNotice("Nothing suggested for that one.");
      }
    } catch {
      setNotice("The assist could not run.");
    } finally {
      setBusy(false);
    }
  }, [busy, goalId, title]);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-4">
          What is measured, and the assist will suggest the numbers
        </span>
        <input
          value={title}
          disabled={busy}
          maxLength={500}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Trial to paid conversion"
          className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-4"
        />
      </label>
      <Button variant="ai" disabled={busy} onClick={() => void run()}>
        <Sparkles className="size-3" />
        Suggest numbers
      </Button>
      {suggested ? (
        /* A section, not a paragraph: `aria-label` needs a role that supports
           it, and a named region is what a screen reader wants here anyway. */
        <section aria-label="Suggested measure" className="text-xs text-ink-3">
          {suggested.baseline} to {suggested.target}
          {suggested.unit ? ` ${suggested.unit}` : ""} · {suggested.direction} ·{" "}
          {suggested.indicatorType}{" "}
          <Verdicts passing={suggested.passing} failing={suggested.failing} />
        </section>
      ) : null}
      {notice ? <p className="text-xs text-ink-4">{notice}</p> : null}
    </div>
  );
}

/**
 * Suggests which objective this one should roll up into, and aligns it.
 *
 * The candidates were drawn from what this reader may see, so the suggestion is
 * never a goal they cannot open. Applying it is the ordinary `goals.update`,
 * which runs the same loop check and the same authorisation as the alignment
 * screen does.
 */
export function SuggestParent({ goalId }: { readonly goalId: string }) {
  const [suggested, setSuggested] = useState<{
    parentGoalId: string;
    parentTitle: string;
    reason: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await suggestParentAction(goalId);
      setSuggested(result);
      if (!result) {
        setNotice("Nothing above this one looks like its parent.");
      }
    } catch {
      setNotice("The assist could not run.");
    } finally {
      setBusy(false);
    }
  }, [goalId]);

  const align = useCallback(async () => {
    if (!suggested) {
      return;
    }
    setBusy(true);
    try {
      await alignToParentAction(goalId, suggested.parentGoalId);
      setSuggested(null);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "That could not be aligned.",
      );
    } finally {
      setBusy(false);
    }
  }, [goalId, suggested]);

  return (
    <div className="flex flex-col gap-1">
      <Button variant="ai" disabled={busy} onClick={() => void run()}>
        <Sparkles className="size-3" />
        Suggest a parent
      </Button>
      {suggested ? (
        <section aria-label="Suggested parent" className="text-xs">
          <p className="text-ink-2">{suggested.parentTitle}</p>
          <p className="text-ink-4">{suggested.reason}</p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void align()}
          >
            Align to it
          </Button>
        </section>
      ) : null}
      {notice ? <p className="text-xs text-ink-4">{notice}</p> : null}
    </div>
  );
}
