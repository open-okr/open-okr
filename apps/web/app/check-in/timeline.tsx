import { excerptRichText } from "@openokr/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  type MessageValues,
} from "@openokr/ui";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "../cycle/action-form.tsx";
import { acknowledgeCheckIn, deleteCheckIn, editCheckIn } from "./actions.ts";

/**
 * The check-in card, with the value differences the snapshot recorded
 * (UIUX-PLAN.md §4 S-15, design §6.2).
 *
 * The differences come from the snapshot rather than from the key results as they
 * stand now. That is the point of storing one: a card read three weeks later shows
 * what changed then, not what has changed since.
 *
 * A card awaiting acknowledgement says so, because REQUIREMENTS.md §51 makes that a
 * first-class state rather than an absence.
 */

export interface TimelineCheckIn {
  readonly id: string;
  readonly state: "draft" | "published";
  readonly status: "on_track" | "caution" | "off_track" | null;
  readonly confidence: number | null;
  readonly narrative: unknown;
  readonly publishedAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly author: { readonly id: string; readonly name: string };
  readonly editable: boolean;
  readonly entries: readonly {
    readonly keyResultId: string;
    readonly title: string;
    readonly value: number;
    readonly previousValue: number | null;
    readonly progressPct: number;
    readonly confidence: number | null;
    readonly previousConfidence: number | null;
  }[];
}

const STATUS_TONE: Readonly<Record<string, "ok" | "warn" | "bad" | "neutral">> =
  {
    on_track: "ok",
    caution: "warn",
    off_track: "bad",
  };

/** `40 → 55 (+15)`, or just the value when nothing came before it. */
function difference(value: number, previous: number | null): string {
  if (previous === null || previous === value) {
    return String(value);
  }
  const delta = value - previous;
  const sign = delta > 0 ? "+" : "";
  return `${previous} → ${value} (${sign}${Math.round(delta * 100) / 100})`;
}

/**
 * Who posted a card, and when and how sure they were, as one message.
 *
 * Four shapes rather than three pieces, so a translator places the date and
 * the confidence where their own language puts them.
 */
function byline(
  t: (key: string, values?: MessageValues) => string,
  entry: TimelineCheckIn,
): string {
  const name = entry.author.name;
  const date = entry.publishedAt
    ? new Date(entry.publishedAt).toLocaleDateString()
    : null;
  const confidence = entry.confidence;
  if (date !== null && confidence !== null) {
    return t("checkIn.timeline.bylineDateConfidence", {
      name,
      date,
      confidence,
    });
  }
  if (date !== null) {
    return t("checkIn.timeline.bylineDate", { name, date });
  }
  if (confidence !== null) {
    return t("checkIn.timeline.bylineConfidence", { name, confidence });
  }
  return name;
}

export async function Timeline({
  checkIns,
  canEdit,
}: {
  readonly checkIns: readonly TimelineCheckIn[];
  readonly canEdit: boolean;
}) {
  const { t } = await getTranslations();

  const published = checkIns.filter((entry) => entry.state === "published");

  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">
          {t("checkIn.timeline.checkInHistory")}
        </h2>
        <Chip tone="neutral">{published.length}</Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        {published.length === 0 ? (
          <p className="text-sm text-ink-3">
            {t("checkIn.timeline.nothingPublishedYetThe")}
          </p>
        ) : (
          published.map((entry) => (
            <article
              key={entry.id}
              className="flex flex-col gap-2 rounded-md border border-line p-2.5"
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Chip tone={STATUS_TONE[entry.status ?? ""] ?? "neutral"}>
                    {(entry.status ?? "").replace("_", " ")}
                  </Chip>
                  <span className="text-xs text-ink-3">{byline(t, entry)}</span>
                </span>
                {entry.acknowledgedAt ? (
                  <Chip tone="ok">{t("checkIn.timeline.acknowledged")}</Chip>
                ) : (
                  <Chip tone="warn">
                    {t("checkIn.timeline.awaitingTheReviewer")}
                  </Chip>
                )}
              </header>

              <p className="text-sm text-ink-2">
                {excerptRichText(entry.narrative as never, 2000) ||
                  t("checkIn.timeline.noNarrativeRecorded")}
              </p>

              {entry.entries.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {entry.entries.map((line) => (
                    <li
                      key={line.keyResultId}
                      className="flex items-baseline justify-between gap-2.5 text-xs"
                    >
                      <span className="min-w-0 text-ink-3">{line.title}</span>
                      <span className="flex-none font-semibold text-ink">
                        {difference(line.value, line.previousValue)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <footer className="flex flex-wrap items-center gap-2">
                {entry.acknowledgedAt ? null : (
                  <ActionForm action={acknowledgeCheckIn}>
                    <input type="hidden" name="checkInId" value={entry.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                    >
                      {t("checkIn.timeline.acknowledge")}
                    </Button>
                  </ActionForm>
                )}
                {canEdit ? (
                  <ActionForm action={deleteCheckIn}>
                    <input type="hidden" name="checkInId" value={entry.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                    >
                      {t("common.delete")}
                    </Button>
                  </ActionForm>
                ) : null}
                {entry.editable ? null : (
                  <span className="text-xs text-ink-4">
                    {t("checkIn.timeline.theWindowHasClosed")}
                  </span>
                )}
              </footer>

              {entry.editable && canEdit ? (
                /* §6.3: an edit inside the window re-snapshots rather than
                   rewriting the old snapshot, so a reviewer who already read the
                   difference still sees what they read. A window nobody can use
                   would be a promise with no button. */
                <ActionForm
                  action={editCheckIn}
                  className="flex flex-wrap items-center gap-1.5 border-line border-t pt-2"
                >
                  <input type="hidden" name="checkInId" value={entry.id} />
                  <label
                    className="text-xs text-ink-3"
                    htmlFor={`edit-status-${entry.id}`}
                  >
                    {t("checkIn.timeline.correctIt")}
                  </label>
                  <select
                    id={`edit-status-${entry.id}`}
                    name="status"
                    defaultValue={entry.status ?? "on_track"}
                    className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink-2"
                  >
                    <option value="on_track">{t("common.onTrack")}</option>
                    <option value="caution">{t("common.caution")}</option>
                    <option value="off_track">{t("common.offTrack")}</option>
                  </select>
                  <label
                    className="sr-only"
                    htmlFor={`edit-confidence-${entry.id}`}
                  >
                    {t("common.confidence")}
                  </label>
                  <input
                    id={`edit-confidence-${entry.id}`}
                    name="confidence"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    defaultValue={entry.confidence ?? 0.5}
                    className="w-28"
                  />
                  <label
                    className="sr-only"
                    htmlFor={`edit-narrative-${entry.id}`}
                  >
                    {t("checkIn.timeline.replaceTheNarrative")}
                  </label>
                  <input
                    id={`edit-narrative-${entry.id}`}
                    name="narrative"
                    placeholder={t("checkIn.timeline.leaveBlankToKeep")}
                    className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-4"
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                  >
                    {t("common.save")}
                  </Button>
                </ActionForm>
              ) : null}
            </article>
          ))
        )}
        <p className="text-xs text-ink-4">
          {t("checkIn.timeline.onlyThisGoalS")}
        </p>
        {/* P3-T07 announced the reviewer's raw id here, as a placeholder until
            P3-T08 built the inbox that lists the obligation. That inbox exists
            now, and a bare UUID read aloud to somebody on a screen reader was
            never useful anyway, so the placeholder is gone rather than reworded. */}
      </CardBody>
    </Card>
  );
}
