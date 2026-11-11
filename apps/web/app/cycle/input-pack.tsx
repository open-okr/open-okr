import { SUGGESTED_TIMELINE } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  cn,
  SubmitButton,
  TextInput,
  Tooltip,
} from "@openokr/ui";
import { Check } from "lucide-react";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "./action-form.tsx";
import { distributePack, savePackNote, togglePackItem } from "./actions.ts";

/**
 * Phase 1's work (UIUX-PLAN.md §4 S-06): the seven-item input pack with its
 * distribution confirmation, the named roles, and the suggested timeline for the
 * mode.
 *
 * METHOD.md §2.6 calls the incomplete pack "the single most common failure point
 * in an OKR programme", which is why this is a checklist somebody has to tick
 * item by item rather than one "we are ready" switch. The seven labels come from
 * the method package, so the list cannot drift from the document. The first
 * note saved into an empty item ticks it too; after that only the box does.
 */

export interface PackItem {
  readonly itemKey: number;
  readonly label: string;
  readonly gathered: boolean;
  readonly note: string | null;
}

export async function InputPack({
  cycleId,
  mode,
  items,
  distributedAt,
  sponsor,
  facilitator,
  canEdit,
}: {
  readonly cycleId: string;
  readonly mode: "annual" | "quarterly";
  readonly items: readonly PackItem[];
  readonly distributedAt: string | null;
  readonly sponsor: { readonly name: string } | null;
  readonly facilitator: { readonly name: string } | null;
  readonly canEdit: boolean;
}) {
  const { t } = await getTranslations();

  const gathered = items.filter((item) => item.gathered).length;

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">
            {t("cycle.inputPack.inputPack")}
          </h2>
          <Chip tone={gathered === items.length ? "ok" : "warn"}>
            {t("common.of", { gathered, length: items.length })}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col divide-y divide-line p-0">
          {items.map((item) => (
            <div
              key={item.itemKey}
              // Where "Input pack item n is missing" leads (plan 0.8.0 F1).
              id={`pack-item-${item.itemKey}`}
              className="flex scroll-mt-20 flex-col gap-1.5 px-3.5 py-3"
            >
              <div className="flex items-start gap-2.5">
                {canEdit ? (
                  <ActionForm
                    action={togglePackItem}
                    className="flex-none pt-0.5"
                  >
                    <input type="hidden" name="cycleId" value={cycleId} />
                    <input type="hidden" name="itemKey" value={item.itemKey} />
                    <input
                      type="hidden"
                      name="gathered"
                      value={String(item.gathered)}
                    />
                    {/* A checkbox to look at (11 November 2026). The dashed
                        red outline read as a status mark, not a control, so
                        nobody pressed it: the red now stays on the chip. The
                        box is 24px for the pointer target, shows a faint tick
                        on hover and says what pressing it does. */}
                    <Tooltip
                      label={
                        item.gathered
                          ? t("cycle.inputPack.tickNotGathered")
                          : t("cycle.inputPack.tickGathered")
                      }
                    >
                      <SubmitButton
                        bare
                        aria-pressed={item.gathered}
                        aria-label={
                          item.gathered
                            ? t("cycle.inputPack.markNotGathered", {
                                label: item.label,
                              })
                            : t("cycle.inputPack.markGathered", {
                                label: item.label,
                              })
                        }
                        className={cn(
                          "size-6 cursor-pointer rounded-md border-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-line motion-reduce:transition-none [&[aria-busy]>.lucide-check]:hidden",
                          item.gathered
                            ? "border-ok bg-ok text-on-ok hover:opacity-85"
                            : "border-line-2 bg-surface text-transparent hover:border-brand hover:bg-brand-weak hover:text-brand-text aria-busy:text-ink-3",
                        )}
                      >
                        <Check
                          aria-hidden="true"
                          strokeWidth={3}
                          className="size-3.5"
                        />
                      </SubmitButton>
                    </Tooltip>
                  </ActionForm>
                ) : (
                  // Read only: the same box with nothing to press, so the
                  // outline is dashed rather than drawn like a control.
                  <span
                    aria-hidden="true"
                    className={
                      item.gathered
                        ? "mt-0.5 flex size-6 flex-none items-center justify-center rounded-md bg-ok text-on-ok"
                        : "mt-0.5 flex size-6 flex-none items-center justify-center rounded-md border-2 border-dashed border-line-2"
                    }
                  >
                    {item.gathered ? (
                      <Check
                        aria-hidden="true"
                        strokeWidth={3}
                        className="size-3.5"
                      />
                    ) : null}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold text-ink">
                    {item.label}
                  </span>
                  {canEdit ? (
                    <ActionForm
                      action={savePackNote}
                      className="flex items-center gap-1.5"
                    >
                      <input type="hidden" name="cycleId" value={cycleId} />
                      <input
                        type="hidden"
                        name="itemKey"
                        value={item.itemKey}
                      />
                      <input
                        type="hidden"
                        name="gathered"
                        value={String(item.gathered)}
                      />
                      {/* Whether the field was drawn empty: the first note
                          saved into an empty item gathers it. */}
                      <input
                        type="hidden"
                        name="hadNote"
                        value={String(Boolean(item.note))}
                      />
                      <TextInput
                        name="note"
                        defaultValue={item.note ?? ""}
                        placeholder={t("cycle.inputPack.whereItIsOr")}
                        label={t("cycle.inputPack.noteFor", {
                          label: item.label,
                        })}
                        hideLabel
                        maxLength={2000}
                        className="min-w-0 flex-1"
                        inputClassName="h-6.5 px-2 text-xs text-ink-2 placeholder:text-ink-4"
                      />
                      <Button type="submit" className="h-7 px-2 text-xs">
                        {t("common.save")}
                      </Button>
                    </ActionForm>
                  ) : item.note ? (
                    <span className="text-xs text-ink-3">{item.note}</span>
                  ) : null}
                </div>
                <Chip tone={item.gathered ? "ok" : "bad"}>
                  {item.gathered
                    ? t("cycle.inputPack.gathered")
                    : t("cycle.inputPack.missing")}
                </Chip>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card id="pack-distribute" className="scroll-mt-20">
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">
            {t("cycle.inputPack.distribution")}
          </h2>
          {distributedAt ? (
            <Chip tone="ok">{t("cycle.inputPack.distributed")}</Chip>
          ) : (
            <Chip tone="warn">{t("cycle.inputPack.notSent")}</Chip>
          )}
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          <p className="text-sm text-ink-2">{t("cycle.inputPack.26AsksFor")}</p>
          {distributedAt ? (
            <p className="text-xs text-ink-3">
              {t("common.sent", {
                distributedAt: new Date(distributedAt).toLocaleString(),
              })}
            </p>
          ) : null}
          {canEdit ? (
            <ActionForm action={distributePack}>
              <input type="hidden" name="cycleId" value={cycleId} />
              <Button
                type="submit"
                variant={distributedAt ? "ghost" : "primary"}
              >
                {distributedAt
                  ? t("cycle.inputPack.recordANewSend")
                  : t("cycle.inputPack.confirmDistribution")}
              </Button>
            </ActionForm>
          ) : null}
        </CardBody>
      </Card>

      {/* Stacked at every width (plan 0.8.0 L1). Side by side, Roles held two
          short entries in half the width and stood mostly empty, while the
          timeline's Activity column was squeezed to two or three words a
          line. Full width, the two roles sit side by side inside their card
          and the timeline gets the room it needs. */}
      <div className="grid gap-4.5" data-testid="roles-and-timeline">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">{t("common.roles")}</h2>
          </CardHeader>
          <CardBody className="grid gap-2.5 text-sm sm:grid-cols-2">
            <div className="flex flex-col">
              <span className="font-semibold text-ink">
                {sponsor?.name ?? t("cycle.inputPack.noSponsorNamed")}
              </span>
              <span className="text-xs text-ink-3">
                {t("cycle.inputPack.sponsorDecidesAndUnblocks")}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-ink">
                {facilitator?.name ?? t("cycle.inputPack.noFacilitatorNamed")}
              </span>
              <span className="text-xs text-ink-3">
                {t("cycle.inputPack.facilitatorGuardsTheMethod")}
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("cycle.inputPack.suggestedTimeline")}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-line border-b">
                  {/* A fixed share that may wrap, so the longest entry ("Weeks
                      1 to 2 of the quarter") no longer sets the width and
                      Activity takes the rest. */}
                  <th className="w-1/4 px-3.5 py-1.5 text-left text-xs font-bold tracking-wide text-ink-3 uppercase">
                    {t("cycle.inputPack.weeksBefore")}
                  </th>
                  <th className="px-3.5 py-1.5 text-left text-xs font-bold tracking-wide text-ink-3 uppercase">
                    {t("common.activity")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {SUGGESTED_TIMELINE[mode].map((row) => (
                  <tr
                    key={row.weeksBefore}
                    className="border-line border-b last:border-0"
                  >
                    <td className="px-3.5 py-2 align-top text-xs font-semibold text-ink-3">
                      {row.weeksBefore}
                    </td>
                    <td className="px-3.5 py-2 text-ink-2">{row.activity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
