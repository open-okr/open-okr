import { Button, NumberInput } from "@openokr/ui";
import { getTranslations } from "../lib/translations";
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
export async function QuickCheckIn({
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
  const { t } = await getTranslations();

  return (
    <ActionForm action={recordFromMap} className="flex flex-col gap-1.5">
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="keyResultId" value={keyResultId} />
      <span className="flex items-end gap-1.5">
        {/* guided-inputs §4.8: the unit beside the number and in its name,
            and an emptied field posts nothing, which the action refuses in
            words rather than recording 0. */}
        <NumberInput
          id={`map-value-${keyResultId}`}
          label={t("quickCheckIn.recordAValue", { unit: "" })}
          name="value"
          unit={unit}
          required
          defaultValue={currentValue}
          // Nine digits fit. A measure in rupiah or impressions reaches them
          // and `w-24` hid half of what was being typed.
          inputClassName="h-auto w-32 px-2 py-1 text-xs"
        />
        <Button type="submit" variant="primary" size="sm">
          {t("common.save")}
        </Button>
      </span>
      <span className="text-xs text-ink-4">
        {t("quickCheckIn.statusAndConfidenceCome")}
      </span>
    </ActionForm>
  );
}
