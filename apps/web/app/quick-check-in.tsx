import { Button } from "@openokr/ui";
import { ActionForm } from "./cycle/action-form.tsx";
import { recordFromMap } from "./work-map-actions.ts";

/**
 * Recording a key result's value from the Work Map's side panel (S-01, P3-T11).
 *
 * This is the control P3-T10's acceptance criterion was waiting for: "when a key
 * result is checked in from the side panel, then progress, RAG and health update
 * live in both the list and the canvas". The write goes through
 * `goals.recordValue`, so the value history, the weighted cascade and the goal's
 * health all follow from it, and the action revalidates the map, the explorer,
 * the goal page and the studio together.
 *
 * **A value, and not a status.** Health follows METHOD.md §3.5's precedence, and
 * the one rule that lets a human set it directly is the check-in, which needs a
 * narrative. A panel that let somebody flip a goal to green with one click would
 * be the shortcut around the ritual the whole product exists to keep.
 */
export function QuickCheckIn({
  goalId,
  keyResultId,
  currentValue,
  unit,
}: {
  readonly goalId: string;
  readonly keyResultId: string;
  readonly currentValue: number;
  readonly unit: string | null;
}) {
  return (
    <ActionForm action={recordFromMap} className="flex flex-col gap-1.5">
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="keyResultId" value={keyResultId} />
      <label
        className="text-xs font-semibold text-ink-2"
        htmlFor={`map-value-${keyResultId}`}
      >
        Record a value{unit ? ` (${unit})` : ""}
      </label>
      <span className="flex items-center gap-1.5">
        <input
          id={`map-value-${keyResultId}`}
          name="value"
          type="number"
          step="any"
          defaultValue={currentValue}
          className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
        />
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
      </span>
      <span className="text-xs text-ink-4">
        Status and confidence come from a check-in, where they arrive with a
        narrative.
      </span>
    </ActionForm>
  );
}
