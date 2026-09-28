import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { getPool } from "../../lib/auth";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { Snippet } from "./palette.tsx";

/**
 * The search page (UIUX-PLAN.md §4 S-32, P5-T13).
 *
 * The phrase is in the URL, so a search is a link somebody can send: the same
 * rule the goals explorer's filters follow. The palette is the fast way in and
 * this is the one you can bookmark.
 *
 * Every row comes from `search.query`, which filters in SQL by the access
 * context on each indexed row. There is nothing on this page that could widen
 * that.
 */

/**
 * The types a reader can narrow to, and what to call each one: the plural on
 * the filter chip and the singular on a result. Both are catalogue keys, so a
 * translation never has to be derived by trimming an English plural.
 */
const TYPES = [
  { value: "goal", label: "search.objectives", one: "search.objective" },
  {
    value: "key_result",
    label: "cycle.reviewAndLearn.keyResults",
    one: "common.keyResult",
  },
  { value: "kpi", label: "common.count", one: "kpis.grid.kpi" },
  {
    value: "initiative",
    label: "common.initiatives",
    one: "search.initiative",
  },
  { value: "task", label: "search.tasks", one: "search.task" },
  {
    value: "document",
    label: "documents.subjectDocuments.documents",
    one: "search.document",
  },
  { value: "comment", label: "search.comments", one: "search.comment" },
  { value: "check_in", label: "search.checkIns", one: "search.checkIn" },
  { value: "session", label: "common.sessions", one: "search.session" },
] as const;

const LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  TYPES.map((one) => [one.value, one.one]),
);

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const query = await searchParams;
  const phrase = (query.q ?? "").trim();
  const type = TYPES.find((one) => one.value === query.type);

  const hits =
    phrase === ""
      ? []
      : await callAction(context, "search.query", {
          text: phrase,
          ...(type ? { entityTypes: [type.value] } : {}),
          limit: 50,
        });

  // A result's type in words, or the raw value for a type with no name here.
  const typeName = (entityType: string): string => {
    const key = LABEL[entityType];
    return key === undefined ? entityType : t(key);
  };

  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({
      q: phrase || null,
      type: type?.value ?? null,
      ...patch,
    })) {
      if (value) {
        next.set(key, value);
      }
    }
    const search = next.toString();
    return search === "" ? "/search" : `/search?${search}`;
  };

  return (
    <div className="flex w-full flex-col gap-3.5">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">
              {t("shell.search.label")}
            </h1>
            <p className="text-xs text-ink-3" data-testid="search-count">
              {phrase === ""
                ? t("search.typeAPhrase")
                : hits.length === 0
                  ? t("search.nothingMatches", { phrase })
                  : hits.length === 1
                    ? t("search.resultsForOne", {
                        count: hits.length,
                        phrase,
                      })
                    : t("search.resultsForOther", {
                        count: hits.length,
                        phrase,
                      })}
            </p>
          </div>
        </CardHeader>

        <CardBody className="flex flex-col gap-3">
          <form action="/search" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-ink-2">
              {t("search.whatAreYouLooking")}
              <input
                name="q"
                defaultValue={phrase}
                placeholder={t("search.midMarketActivation")}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </label>
            {type ? (
              <input type="hidden" name="type" value={type.value} />
            ) : null}
            <button
              type="submit"
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand"
            >
              {t("shell.search.label")}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={href({ type: null })}
              aria-current={type ? undefined : "true"}
              className={
                type
                  ? "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
                  : "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
              }
            >
              {t("search.everything")}
            </Link>
            {TYPES.map((one) => (
              <Link
                key={one.value}
                href={href({ type: one.value })}
                aria-current={type?.value === one.value ? "true" : undefined}
                className={
                  type?.value === one.value
                    ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                    : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
                }
              >
                {t(one.label)}
              </Link>
            ))}
          </div>

          {hits.length === 0 ? (
            <p className="rounded-md border border-line border-dashed px-3 py-6 text-center text-sm text-ink-3">
              {phrase === ""
                ? t("search.allSearchable")
                : t("search.nothingHereADraft")}
            </p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-line"
              data-testid="search-results"
            >
              {hits.map((hit) => (
                <li
                  key={`${hit.entityType}:${hit.entityId}`}
                  className="flex flex-col gap-1 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={hit.href}
                      className="text-sm font-semibold text-ink hover:text-brand-text"
                    >
                      {hit.title}
                    </Link>
                    <Chip tone="neutral">{typeName(hit.entityType)}</Chip>
                    {hit.semantic ? (
                      // Marked, because a semantic hit answered a different
                      // question from the one the words asked.
                      <Chip tone="info">{t("search.related")}</Chip>
                    ) : null}
                  </div>
                  <p className="text-xs text-ink-3">
                    <Snippet text={hit.snippet} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
