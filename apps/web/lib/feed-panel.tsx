import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";

/**
 * A feed, as a panel on the thing it is about (S-31, P6-G11b).
 *
 * **`queryFeed` could answer all four scopes and only one was reachable.**
 * P6-G11a built the workspace feed at `/activity`; the space, goal and profile
 * scopes §6 asks for had no read action, so nothing could show them. The three
 * reads arrive with this, and one panel serves all of them because a feed row
 * reads the same wherever it is.
 *
 * **The actor's name comes from the directory, not from the row.** A renderer
 * describes the subject ("Goal X was created") and never the actor, so the
 * caller joins `actorMemberId` against `people.directory`. A row whose actor
 * is a system principal has none, and reads as the product acting rather than
 * as an empty name.
 *
 * **Paging is a link, not state.** The cursor is the last row's own key, which
 * is what keeps a page stable while new rows arrive above it. Each scope pages
 * on its own url, which is what "each scope pages independently" means.
 */

export interface FeedRow {
  readonly id: string;
  readonly rendered: string;
  readonly actorMemberId: string | null;
  readonly at: string;
  readonly aggregatedCount: number;
}

export function FeedPanel({
  title,
  explains,
  items,
  names,
  timeZone,
  /** This surface's own url, for the older-page link. */
  basePath,
  paged,
}: {
  readonly title: string;
  readonly explains: string;
  readonly items: readonly FeedRow[];
  readonly names: ReadonlyMap<string, string>;
  readonly timeZone: string;
  readonly basePath: string;
  /** Whether the reader is already on a later page. */
  readonly paged: boolean;
}) {
  const last = items.at(-1);
  const join = basePath.includes("?") ? "&" : "?";

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">{title}</h2>
          <p className="text-xs text-ink-3">{explains}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-2.5">
        {items.length === 0 ? (
          <p className="text-sm text-ink-3">
            {paged ? "Nothing further back than this." : "Nothing yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-line border-b pb-2.5 last:border-0 last:pb-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm text-ink">{item.rendered}</span>
                  <span className="text-xs text-ink-4">
                    {item.actorMemberId
                      ? (names.get(item.actorMemberId) ?? "A member")
                      : "OpenOKR"}
                    {" · "}
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone,
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(item.at))}
                  </span>
                </span>
                {item.aggregatedCount > 1 ? (
                  <Chip tone="neutral">
                    {item.aggregatedCount} edits together
                  </Chip>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* A page shorter than the action's own size is the end, so there is
            nothing to offer. */}
        {last && items.length > 1 ? (
          <div className="flex items-center justify-between gap-3">
            {paged ? (
              <Link
                href={basePath}
                className="text-xs font-semibold text-brand-text hover:underline"
              >
                Back to the newest
              </Link>
            ) : (
              <span />
            )}
            <Link
              href={`${basePath}${join}at=${encodeURIComponent(last.at)}&id=${last.id}`}
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              Older
            </Link>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
