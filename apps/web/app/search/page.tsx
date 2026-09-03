import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
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

/** The types a reader can narrow to, and what to call each one. */
const TYPES = [
  { value: "goal", label: "Objectives" },
  { value: "key_result", label: "Key results" },
  { value: "kpi", label: "KPIs" },
  { value: "initiative", label: "Initiatives" },
  { value: "task", label: "Tasks" },
  { value: "document", label: "Documents" },
  { value: "comment", label: "Comments" },
  { value: "check_in", label: "Check-ins" },
  { value: "session", label: "Sessions" },
] as const;

const LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  TYPES.map((one) => [one.value, one.label.replace(/s$/, "")]),
);

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
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
    <AppShellLayout>
      <div className="flex w-full flex-col gap-3.5">
        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">Search</h1>
              <p className="text-xs text-ink-3" data-testid="search-count">
                {phrase === ""
                  ? "Type a phrase. Only what you can already open is searched."
                  : hits.length === 0
                    ? `Nothing matches "${phrase}".`
                    : `${hits.length} ${hits.length === 1 ? "result" : "results"} for "${phrase}".`}
              </p>
            </div>
          </CardHeader>

          <CardBody className="flex flex-col gap-3">
            <form action="/search" className="flex flex-wrap items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-ink-2">
                What are you looking for
                <input
                  name="q"
                  defaultValue={phrase}
                  placeholder="mid-market activation"
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
                Search
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
                Everything
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
                  {one.label}
                </Link>
              ))}
            </div>

            {hits.length === 0 ? (
              <p className="rounded-md border border-line border-dashed px-3 py-6 text-center text-sm text-ink-3">
                {phrase === ""
                  ? "Goals, key results, KPIs, initiatives, tasks, documents, comments, check-ins and sessions are all searchable."
                  : "Nothing here. A draft nobody has published is not searchable, and neither is anything you could not already open."}
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
                      <Chip tone="neutral">
                        {LABEL[hit.entityType] ?? hit.entityType}
                      </Chip>
                      {hit.semantic ? (
                        // Marked, because a semantic hit answered a different
                        // question from the one the words asked.
                        <Chip tone="info">Related</Chip>
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
    </AppShellLayout>
  );
}
