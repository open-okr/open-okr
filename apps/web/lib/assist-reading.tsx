"use client";

/**
 * An assist that reads something and writes nothing (completeness review
 * M-09).
 *
 * Three assists have this shape: the KPI trend narration, the blocker
 * summary and the thread summary. Each answers with prose and a short list
 * (the anomalies, the open questions) or with nothing, and each sits beside a
 * deterministic surface that stays exactly as it was. One component, so the
 * three say "AI" the same way, and say the same thing when the model has
 * nothing to add.
 *
 * **Null is not an error.** It covers a model that declined, a narration the
 * product refused because it stated a number nobody measured, and a summary
 * that quoted words nobody wrote. The reader is told the page is the whole
 * answer, which is true in all three cases.
 */
import { Button, Chip, useTranslations } from "@openokr/ui";
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";

export interface Reading {
  readonly text: string;
  readonly points: readonly string[];
}

export function AssistReading({
  label,
  note,
  pointsHeading,
  read,
  testId,
}: {
  /** What the button says. */
  readonly label: string;
  /** One line beside the AI chip, saying what the reading is over. */
  readonly note: string;
  /** The heading over the list, when there is one. */
  readonly pointsHeading: string;
  readonly read: () => Promise<Reading | null>;
  readonly testId: string;
}) {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  const [reading, setReading] = useState<Reading | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {reading === null ? (
        <Button
          type="button"
          variant="ai"
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() => {
            setNotice(null);
            start(async () => {
              try {
                const result = await read();
                setReading(result);
                if (result === null) {
                  setNotice(t("assists.reading.nothingThisTime"));
                }
              } catch {
                setNotice(t("assists.reading.couldNotRun"));
              }
            });
          }}
        >
          <Sparkles className="size-3" />
          {pending ? t("assists.reading.working") : label}
        </Button>
      ) : (
        <section
          aria-label={label}
          className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3"
        >
          <span className="flex items-center gap-2">
            <Chip tone="agent">{t("common.ai")}</Chip>
            <span className="text-xs text-ink-4">{note}</span>
          </span>
          <p className="text-sm text-ink">{reading.text}</p>
          {reading.points.length > 0 ? (
            <>
              <h3 className="text-xs font-semibold text-ink-2">
                {pointsHeading}
              </h3>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {reading.points.map((point) => (
                  <li key={point} className="text-sm text-ink-2">
                    {point}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setReading(null)}
          >
            {t("assists.reading.hide")}
          </Button>
        </section>
      )}
      {notice ? (
        <p role="status" className="text-xs text-ink-4">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
