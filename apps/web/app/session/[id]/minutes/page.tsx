/**
 * S-25, the minutes (METHOD.md §8.10, P4-T12-a).
 *
 * The generated document: the executive summary, then every stage's record, then
 * the two exports.
 *
 * **A server component with no interactivity of its own.** Everything on it comes
 * from `sessions.minutes`, and the exports are plain links to routes that call
 * the same read. Nothing here filters or recomputes: the management retro is
 * already absent from the payload for a reader who may not see it, and the
 * facilitator's private notes are absent for everybody.
 */

import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "../../../../lib/auth";
import { getTranslations } from "../../../../lib/translations";
import { requireWorkspace } from "../../../../lib/workspace";
import type { Minutes } from "./minutes-document";

const VERDICTS: Record<string, string> = {
  results_delivered: "Results delivered",
  strategy_or_quality: "Strategy or OKR-quality problem",
  rhythm: "Rhythm problem",
};

const COLUMNS: Record<string, string> = {
  worked: "What worked",
  didnt: "What did not",
};

function Section({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: React.ReactNode;
}) {
  // A stage that produced nothing is absent rather than shown empty. An empty
  // heading in a record reads as a stage that was skipped.
  if (count === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

export default async function MinutesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t } = await getTranslations();

  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  let minutes: Minutes;
  try {
    minutes = (await callAction(context, "sessions.minutes", {
      sessionId: id,
    })) as Minutes;
  } catch {
    notFound();
  }

  const summary = minutes.summary;

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <h1 className="flex-1 text-lg font-bold text-ink">{minutes.title}</h1>
          <Link
            className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2"
            href={`/session/${id}/minutes/export`}
          >
            {t("session.detail.minutes.downloadMarkdown")}
          </Link>
          <Link
            className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2"
            href={`/session/${id}/minutes/pdf`}
          >
            {t("session.detail.minutes.downloadPdf")}
          </Link>
          <Link
            className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2"
            href={`/session/${id}`}
          >
            {t("session.detail.minutes.backToTheReview")}
          </Link>
        </span>
        {minutes.state === "closed" ? (
          <p className="text-xs text-ink-4">
            {t("session.detail.minutes.held")}{" "}
            {minutes.heldOn?.slice(0, 10) ?? "recently"}.
          </p>
        ) : (
          <p className="text-xs text-warn">
            {/* Said plainly: a draft that does not say so gets quoted as a
                record. */}
            {t("session.detail.minutes.thisReviewIsStill")}
          </p>
        )}
      </header>

      <Card role="region" aria-labelledby="minutes-summary-heading">
        <CardHeader>
          <span className="flex flex-wrap items-center gap-2">
            <h2
              id="minutes-summary-heading"
              className="flex-1 text-sm font-bold text-ink"
            >
              {t("session.detail.minutes.executiveSummary")}
            </h2>
            {summary.verdict === null ? null : (
              <Chip
                tone={
                  summary.verdict === "results_delivered"
                    ? "ok"
                    : summary.verdict === "rhythm"
                      ? "bad"
                      : "warn"
                }
              >
                {VERDICTS[summary.verdict] ?? summary.verdict}
              </Chip>
            )}
          </span>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [
                "Cycle score",
                summary.cycleScore === null
                  ? "not read"
                  : summary.cycleScore.toFixed(2),
              ],
              ["Objectives", String(summary.objectivesReviewed)],
              ["Key results", String(summary.keyResultsReviewed)],
              [
                `Below ${summary.threshold.toFixed(1)}`,
                String(summary.belowThreshold),
              ],
              [
                "Team pulse",
                summary.teamPulse === null
                  ? "none"
                  : `${summary.teamPulse.toFixed(1)} of 5`,
              ],
              ["Learnings carried", String(summary.learningsCarried)],
              ["Actions agreed", String(summary.actionsAgreed)],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-xs text-ink-4">{label}</dt>
                <dd className="text-sm font-bold tabular-nums text-ink">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <Section
            title={t("session.detail.minutes.scores")}
            count={minutes.scores.length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.scores.map((row) => (
                <li
                  key={`${row.goalTitle}-${row.keyResultTitle}`}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <span className="w-8 font-bold tabular-nums text-ink">
                    {row.score.toFixed(1)}
                  </span>
                  <span className="flex-1 text-ink">{row.keyResultTitle}</span>
                  <span className="text-xs text-ink-3">{row.reason}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("common.objectiveNarratives")}
            count={minutes.narratives.filter((row) => row.excerpt).length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.narratives
                .filter((row) => row.excerpt)
                .map((row) => (
                  <li key={row.goalTitle} className="text-sm text-ink">
                    <span className="font-medium">{row.goalTitle}</span>{" "}
                    <span className="text-ink-2">{row.excerpt}</span>
                  </li>
                ))}
            </ul>
          </Section>

          <Section
            title={t("session.detail.minutes.recognition")}
            count={minutes.recognition.length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.recognition.map((row) => (
                <li key={row.text} className="text-sm text-ink">
                  <span className="font-medium">{row.toName}</span>{" "}
                  <span className="text-xs text-ink-4">
                    {t("common.namedBy")} {row.fromName}
                  </span>
                  <span className="block text-ink-2">{row.text}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t("common.teamRetro")} count={minutes.retro.length}>
            <ul className="flex flex-col gap-1">
              {minutes.retro.map((row) => (
                <li
                  key={row.text}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <span className="text-xs text-ink-4">
                    {COLUMNS[row.columnKey] ?? row.columnKey}
                  </span>
                  <span className="flex-1 text-ink">{row.text}</span>
                  <Chip tone={row.votes === 0 ? "neutral" : "ok"}>
                    {row.votes}
                  </Chip>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("common.managementRetro")}
            count={minutes.management?.length ?? 0}
          >
            <ul className="flex flex-col gap-1.5">
              {(minutes.management ?? []).map((row) => (
                <li key={row.question} className="flex flex-col text-sm">
                  <span className="text-ink-3">{row.question}</span>
                  <span className="text-ink">{row.body}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("session.detail.minutes.rootCauses")}
            count={minutes.rootCauses.length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.rootCauses.map((row) => (
                <li key={row.keyResultTitle} className="text-sm text-ink">
                  <span className="text-ink-2">{row.keyResultTitle}</span>{" "}
                  <span className="font-medium">{row.cause}</span>
                  {row.detail ? (
                    <span className="text-ink-3"> — {row.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("session.detail.minutes.processHealth")}
            count={minutes.processHealth.length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.processHealth.map((row) => (
                <li
                  key={row.statement}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <span className="w-8 font-bold tabular-nums text-ink">
                    {row.average.toFixed(1)}
                  </span>
                  <span className="flex-1 text-ink-2">{row.statement}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("common.keepModifyOrAbandon")}
            count={minutes.decisions.length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.decisions.map((row) => (
                <li key={row.goalTitle} className="text-sm text-ink">
                  <Chip tone="neutral">{row.decision}</Chip>{" "}
                  <span>{row.goalTitle}</span>
                  <span className="block text-xs text-ink-3">{row.why}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("common.learnings")}
            count={minutes.learnings.length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.learnings.map((row) => (
                <li
                  key={row.text}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <span className="flex-1 text-ink">{row.text}</span>
                  {row.carryForward ? (
                    <Chip tone="ok">{t("common.carried")}</Chip>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("common.nextCycleDrafts")}
            count={minutes.drafts.length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.drafts.map((row) => (
                <li key={row.title} className="text-sm text-ink">
                  {row.title}
                  <span className="block text-xs text-ink-3">{row.why}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title={t("session.detail.minutes.actions")}
            count={minutes.actions.length}
          >
            <ul className="flex flex-col gap-1">
              {minutes.actions.map((row) => (
                <li
                  key={row.what}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <span className="flex-1 text-ink">{row.what}</span>
                  <span className="text-xs text-ink-3">{row.ownerName}</span>
                  <span className="text-xs text-ink-3">{row.dueOn}</span>
                  <Chip tone={row.done ? "ok" : "warn"}>
                    {row.done ? "done" : "open"}
                  </Chip>
                </li>
              ))}
            </ul>
          </Section>

          {minutes.scores.length === 0 &&
          minutes.actions.length === 0 &&
          minutes.learnings.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("session.detail.minutes.thisReviewHasNot")}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
