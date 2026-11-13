import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { stamper } from "../../../lib/stamper";
import { getTranslations } from "../../../lib/translations";

/** Which ratings the list shows. */
export type RatingsFilter = "all" | "down" | "up";

/** One rating as `ai.answerRatings` returns it. */
export interface RatingRow {
  readonly id: string;
  readonly at: string;
  readonly rating: "up" | "down";
  readonly note: string | null;
  readonly model: string | null;
  readonly member: string;
  readonly readCount: number;
  readonly shared: boolean;
  /** Present only for a shared rating: the server sends no text otherwise. */
  readonly question?: string | null;
  readonly answer?: string;
}

/** The address of the list for a filter and, past the first page, a cursor. */
function listHref(filter: RatingsFilter, before?: RatingRow): string {
  const params = new URLSearchParams();
  if (filter !== "all") {
    params.set("ratings", filter);
  }
  if (before) {
    params.set("before", `${before.at}_${before.id}`);
  }
  const query = params.toString();
  return `/admin/ai${query === "" ? "" : `?${query}`}#ratings`;
}

/**
 * How members rated the copilot's answers, on S-37 (plan 0.9.0 FB1,
 * docs/design/copilot-feedback.md FB-D4, section 4).
 *
 * A rating is about the copilot, so every row shows its note, its model and
 * how many reads it rested on. **The question and the answer appear only on a
 * rating the member shared**, folded under "Shared": the server sends no text
 * for any other row, so there is nothing here to hide.
 */
export async function RatingsCard({
  rows,
  more,
  filter,
  paged,
  timeZone,
}: {
  readonly rows: readonly RatingRow[];
  readonly more: boolean;
  readonly filter: RatingsFilter;
  /** A later page than the first, which offers a way back to the newest. */
  readonly paged: boolean;
  readonly timeZone: string;
}) {
  const { t } = await getTranslations();
  const { stamp } = stamper(timeZone);
  const filters: readonly {
    readonly value: RatingsFilter;
    readonly label: string;
  }[] = [
    { value: "all", label: t("admin.ai.ratings.filterAll") },
    { value: "down", label: t("admin.ai.ratings.filterPoor") },
    { value: "up", label: t("admin.ai.ratings.filterGood") },
  ];
  const last = rows.at(-1);
  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 id="ratings" className="text-sm font-bold text-ink">
          {t("admin.ai.ratings.title")}
        </h2>
        <nav
          aria-label={t("admin.ai.ratings.filter")}
          className="flex items-center gap-2 text-xs"
        >
          {filters.map((option) => (
            <Link
              key={option.value}
              href={listHref(option.value)}
              aria-current={option.value === filter ? "page" : undefined}
              className={
                option.value === filter
                  ? "font-bold text-ink underline"
                  : "text-ink-3 hover:text-ink"
              }
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </CardHeader>
      <CardBody className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-ink-3">{t("admin.ai.ratings.about")}</p>
        {rows.length === 0 ? (
          <p className="text-xs text-ink-3">{t("admin.ai.ratings.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 rounded-md border border-line px-3 py-2"
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                  <Chip tone={row.rating === "down" ? "bad" : "ok"}>
                    {row.rating === "down"
                      ? t("admin.ai.ratings.poor")
                      : t("admin.ai.ratings.good")}
                  </Chip>
                  <span>{stamp(row.at)}</span>
                  <span className="text-ink-2">{row.member}</span>
                  {row.model ? (
                    <code className="font-mono">{row.model}</code>
                  ) : null}
                  <span>
                    {t("admin.ai.ratings.reads", { count: row.readCount })}
                  </span>
                </p>
                {row.note ? (
                  <p className="whitespace-pre-wrap break-words text-ink">
                    {row.note}
                  </p>
                ) : null}
                {row.shared ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-ink-2">
                      {t("admin.ai.ratings.shared")}
                    </summary>
                    <div className="mt-1 flex flex-col gap-1.5">
                      <div>
                        <p className="text-ink-4">
                          {t("admin.ai.ratings.question")}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-ink-2">
                          {row.question ?? ""}
                        </p>
                      </div>
                      <div>
                        <p className="text-ink-4">
                          {t("admin.ai.ratings.answer")}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-ink-2">
                          {row.answer ?? ""}
                        </p>
                      </div>
                    </div>
                  </details>
                ) : (
                  <p className="text-xs text-ink-4">
                    {t("admin.ai.ratings.notShared")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-3 text-xs">
          {paged ? (
            <Link href={listHref(filter)} className="text-ink-2 underline">
              {t("admin.ai.ratings.newest")}
            </Link>
          ) : null}
          {more && last ? (
            <Link
              href={listHref(filter, last)}
              className="text-ink-2 underline"
            >
              {t("admin.ai.ratings.older")}
            </Link>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
