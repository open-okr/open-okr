"use client";

/**
 * A sentence turned into the explorer's own filters (S-09, P4-T15d).
 *
 * **What it produces is the explorer's filter state, not a separate result set.**
 * On success it navigates to the same URL a reader would have reached by clicking
 * the filter chips, so what they get is editable with the controls they already
 * know: click "Any" on Health and the assist's answer is gone. That is the row's
 * acceptance criterion, and it is why this component navigates rather than
 * rendering a list of its own.
 *
 * **A refusal is shown as a refusal.** The action never approximates: a sentence
 * the four filters cannot express comes back with the reason, and the reader is
 * left exactly where they were with their manual filters intact.
 */
import { Button, Chip } from "@openokr/ui";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { parseFilterAction } from "./filter-actions.ts";

export function FilterAssist() {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const run = useCallback(async () => {
    const asked = sentence.trim();
    if (asked === "" || busy) {
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const parsed = await parseFilterAction(asked);
      if (!parsed) {
        setRefusal("The assist could not run. The filters above still work.");
        return;
      }
      if (parsed.kind === "refused") {
        setRefusal(parsed.reason);
        return;
      }

      // The explorer's own query, so the result is filters they can edit.
      const query = new URLSearchParams();
      if (parsed.filter.cycleId) {
        query.set("cycle", parsed.filter.cycleId);
      }
      if (parsed.filter.level) {
        query.set("level", parsed.filter.level);
      }
      if (parsed.filter.health) {
        query.set("health", parsed.filter.health);
      }
      if (parsed.filter.mine) {
        query.set("mine", "1");
      }
      if (parsed.filter.includeClosed) {
        query.set("closed", "1");
      }
      setSentence("");
      router.push(`/goals?${query.toString()}`);
    } catch {
      setRefusal("The assist could not run. The filters above still work.");
    } finally {
      setBusy(false);
    }
  }, [busy, router, sentence]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Capped rather than full width. A one-line sentence box stretched to
       * 1100px on a wide screen, which is the same defect as an 1800px input
       * for somebody's name: the field should be as wide as what goes in it. */}
      <div className="flex max-w-2xl items-center gap-2">
        <Chip tone="agent">
          <Sparkles className="size-3" />
          AI
        </Chip>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Describe the list you want</span>
          <input
            value={sentence}
            disabled={busy}
            maxLength={300}
            onChange={(event) => setSentence(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void run();
              }
            }}
            placeholder="my off-track goals this quarter"
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
          />
        </label>
        <Button
          variant="ai"
          disabled={busy || sentence.trim() === ""}
          onClick={() => void run()}
        >
          Filter
        </Button>
      </div>
      {refusal ? (
        /* A section, not a paragraph: `aria-label` needs a role that supports
           it, and a refusal is worth being a named region a reader can find. */
        <section
          aria-label="Why that cannot be filtered"
          className="text-xs text-ink-3"
        >
          {refusal}
        </section>
      ) : null}
    </div>
  );
}
