import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  RichTextField,
  RichTextView,
} from "@openokr/ui";
import { richTextHtml } from "../../lib/rich-text-html.ts";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "./action-form.tsx";
import { setFrame } from "./frame-actions.ts";

/**
 * Phase 0, the annual frame (UIUX-PLAN.md §6 S-05, P6-G14).
 *
 * **The table held a mission and nothing could put one in it.** Migration 0020
 * gave `annual_frames` mission, vision, strategy and not-doing columns with a
 * version beside each, back at P3-T02, and `frame.read` returned four scalars
 * and a list of strategies. So phase 0 rendered a card saying the surface
 * arrives later while the storage for it had been waiting for months. That is
 * what made B-03 a blocker rather than a missing screen.
 *
 * **A new year supersedes; the same year is edited in place.** The action
 * carries the prose forward when this form does not name it, so adding a
 * strategy in March does not silently drop the mission somebody wrote in
 * January.
 *
 * **An agreed frame may be revised within its year, with a written reason**
 * (METHOD.md §2.1, P9-T13-c-c), so the form asks for one once the frame is
 * agreed and lists every revision since, with its reason, beneath it. The
 * action refuses a revision without one, so the field is a convenience and
 * not the rule.
 *
 * **Two to five strategies, and the form says so rather than enforcing it.**
 * §2.1 gives that range as the practice; the action accepts up to twenty
 * because refusing a sixth mid-conversation would stop a workshop rather than
 * coach it. The Coach's own check is where that judgement belongs.
 */

interface FrameRevision {
  readonly id: string;
  readonly fields: readonly (
    | "mission"
    | "vision"
    | "strategy"
    | "notDoing"
    | "strategies"
    | "agreed"
  )[];
  readonly reason: string;
  readonly revisedAt: string;
  readonly authorName: string | null;
}

export interface Frame {
  readonly yearLabel: string;
  readonly horizonLabel: string | null;
  readonly agreed: boolean;
  readonly mission: unknown;
  readonly vision: unknown;
  readonly strategy: unknown;
  readonly notDoing: unknown;
  /** Every revision since it was agreed, newest first (P9-T13-c-c). */
  readonly revisions: readonly FrameRevision[];
  readonly strategies: readonly {
    readonly id: string;
    readonly text: string;
    readonly note: string | null;
  }[];
}

export async function AnnualFrame({
  frame,
  canEdit,
}: {
  readonly frame: Frame | null;
  readonly canEdit: boolean;
}) {
  const { t } = await getTranslations();

  const strategies = frame?.strategies ?? [];

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("cycle.annualFrame.theAnnualFrame")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("cycle.annualFrame.whereTheYearIs")}
            </p>
          </div>
          {frame ? (
            <Chip tone={frame.agreed ? "ok" : "warn"}>
              {frame.agreed
                ? t("cycle.annualFrame.agreedChip")
                : t("cycle.annualFrame.notAgreedYet")}
            </Chip>
          ) : (
            <Chip tone="neutral">{t("cycle.annualFrame.notWritten")}</Chip>
          )}
        </CardHeader>
        <CardBody>
          {frame === null ? (
            <p className="text-sm text-ink-2">
              {t("cycle.annualFrame.nothingWrittenForThis")}
            </p>
          ) : null}

          {canEdit ? (
            <ActionForm action={setFrame} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  {t("cycle.annualFrame.year")}
                  <input
                    name="yearLabel"
                    required
                    defaultValue={
                      frame?.yearLabel ?? String(new Date().getFullYear())
                    }
                    className="w-32 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  {t("cycle.annualFrame.horizonTheMidTerm")}
                  <input
                    name="horizonLabel"
                    defaultValue={frame?.horizonLabel ?? ""}
                    placeholder={t("cycle.annualFrame.threeYearsOutSay")}
                    className="w-72 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex items-end gap-2 pb-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="agreed"
                    defaultChecked={frame?.agreed ?? false}
                    className="size-4"
                  />
                  {t("cycle.annualFrame.agreed")}
                </label>
              </div>

              {(
                [
                  [
                    "mission",
                    t("common.mission"),
                    t("cycle.annualFrame.missionHint"),
                  ],
                  [
                    "vision",
                    t("cycle.annualFrame.vision"),
                    t("cycle.annualFrame.visionHint"),
                  ],
                  [
                    "strategy",
                    t("cycle.annualFrame.midTermStrategy"),
                    t("cycle.annualFrame.strategyHint"),
                  ],
                  [
                    "notDoing",
                    t("cycle.annualFrame.notDoingThisYear"),
                    t("cycle.annualFrame.notDoingHint"),
                  ],
                ] as const
              ).map(([name, label, hint]) => (
                // The compact editor (guided-inputs §4.7), sent on every save
                // as it stands, so the frame keeps what nobody touched.
                <RichTextField
                  key={name}
                  label={label}
                  name={name}
                  content={frame?.[name] ?? null}
                  description={hint}
                  sendUnchanged
                />
              ))}

              <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-3">
                  {t("cycle.annualFrame.strategies")}
                </legend>
                <p className="text-xs text-ink-3">
                  {t("cycle.annualFrame.twoToFiveEach")}
                </p>
                {[0, 1, 2, 3, 4].map((index) => (
                  <div key={index} className="flex flex-wrap gap-2">
                    <input
                      name="strategyText"
                      defaultValue={strategies[index]?.text ?? ""}
                      placeholder={t("cycle.annualFrame.strategyNumber", {
                        number: index + 1,
                      })}
                      className="w-72 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                    <input
                      name="strategyNote"
                      defaultValue={strategies[index]?.note ?? ""}
                      placeholder={t("cycle.annualFrame.whatItMeansIn")}
                      className="w-96 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </div>
                ))}
              </fieldset>

              {frame?.agreed ? (
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  {t("cycle.annualFrame.revisionReason")}
                  <span className="text-ink-4">
                    {t("cycle.annualFrame.revisionReasonHint")}
                  </span>
                  <input
                    name="reason"
                    maxLength={500}
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
              ) : null}

              <Button type="submit" variant="default" size="sm">
                {frame
                  ? t("cycle.annualFrame.replaceTheFrame")
                  : t("cycle.annualFrame.writeTheFrame")}
              </Button>
            </ActionForm>
          ) : (
            <ReadOnlyFrame frame={frame} />
          )}
          {frame && frame.revisions.length > 0 ? (
            <Revisions revisions={frame.revisions} />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

/** What each revised field is called on this screen. */
const FIELD_LABEL_KEYS = {
  mission: "common.mission",
  vision: "cycle.annualFrame.vision",
  strategy: "cycle.annualFrame.midTermStrategy",
  notDoing: "cycle.annualFrame.notDoingThisYear",
  strategies: "cycle.annualFrame.strategies",
  agreed: "cycle.annualFrame.agreement",
} as const;

/**
 * The frame's revisions this year, each with its reason (METHOD.md §2.1,
 * NW-Q2-22): what the year's frame said in March and why it changed in June.
 */
async function Revisions({
  revisions,
}: {
  readonly revisions: readonly FrameRevision[];
}) {
  const { t } = await getTranslations();
  return (
    <section
      className="mt-4 flex flex-col gap-1.5 border-line border-t pt-3"
      data-testid="frame-revisions"
    >
      <h3 className="text-xs font-bold uppercase tracking-wide text-ink-3">
        {t("cycle.annualFrame.revisions")}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {revisions.map((revision) => {
          const fields = revision.fields
            .map((field) => t(FIELD_LABEL_KEYS[field]))
            .join(", ");
          const date = revision.revisedAt.slice(0, 10);
          return (
            <li key={revision.id} className="flex flex-col text-sm text-ink-2">
              <span className="text-xs text-ink-3">
                {revision.authorName
                  ? t("cycle.annualFrame.revisedBy", {
                      date,
                      name: revision.authorName,
                      fields,
                    })
                  : t("cycle.annualFrame.revisedOn", { date, fields })}
              </span>
              <span>{revision.reason}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function ReadOnlyFrame({ frame }: { readonly frame: Frame | null }) {
  const { t } = await getTranslations();

  if (!frame) {
    return (
      <p className="text-xs text-ink-3">
        {t("cycle.annualFrame.writingTheFrameIs")}
      </p>
    );
  }
  // As written, formatting and all, where this was the paragraph text alone.
  const fields: readonly (readonly [string, string | null])[] = [
    [t("common.mission"), richTextHtml(frame.mission)],
    [t("cycle.annualFrame.vision"), richTextHtml(frame.vision)],
    [t("cycle.annualFrame.midTermStrategy"), richTextHtml(frame.strategy)],
    [t("cycle.annualFrame.notDoingThisYear"), richTextHtml(frame.notDoing)],
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {fields.map(([label, html]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-ink-3">{label}</span>
          {html === null ? (
            <p className="text-sm text-ink-2">
              {t("cycle.annualFrame.notWrittenYet")}
            </p>
          ) : (
            <RichTextView html={html} className="text-sm text-ink-2" />
          )}
        </div>
      ))}
      {frame.strategies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-3">
            {t("cycle.annualFrame.strategies")}
          </span>
          <ul className="flex flex-col gap-1">
            {frame.strategies.map((one) => (
              <li key={one.id} className="text-sm text-ink-2">
                {one.text}
                {one.note ? (
                  <span className="ml-1.5 text-xs text-ink-3">{one.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
