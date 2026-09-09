import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { FeedLive } from "../../lib/feed-live.tsx";
import { getPool } from "../../lib/pool";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";

/**
 * The activity feed (UIUX-PLAN.md §6 S-31, TECHNICAL-PLAN §4.11, P6-G11a).
 *
 * **The engine has been complete and unread since P2-T07.** Nineteen
 * catalogued event kinds, a renderer each, access-scoped queries at four
 * scopes, consecutive-edit aggregation, key-based paging, and
 * `activities.workspaceFeed` in the registry with no caller anywhere. Every
 * operation in the product writes one of these rows and nobody has ever been
 * able to look at one. The gap audit of 7 September 2026 recorded it as G-01.
 *
 * **It has a route and no sidebar entry, and both halves are deliberate.** §6
 * gives S-31 a screen; §3's sidebar lists nine items and Activity is not one of
 * them. So this is reachable from the work map rather than from the nav, which
 * is what §3 actually describes, and `reachability.test.ts` is satisfied by
 * that link rather than by a registry row nobody asked for.
 *
 * **Distinct from the audit log, and the page says so.** They are two different
 * records and confusing them is a real risk: this one is human-readable,
 * permission-filtered and aggregated, and the audit chain is none of those. A
 * reader looking for who changed what for a compliance answer needs
 * `pnpm audit:verify`, not this.
 *
 * **The actor's name comes from the directory, not from the row.** A renderer
 * describes the subject ("Goal X was created"), never the actor, so the page
 * joins `actorMemberId` against `people.directory`. A row whose actor is a
 * system principal has none, and reads as the product acting rather than as an
 * empty name.
 */

/** Paging is the action's own: it takes a cursor and sets its own page size. */
interface Cursor {
  readonly at: string;
  readonly id: string;
}

function parseCursor(
  at: string | undefined,
  id: string | undefined,
): Cursor | undefined {
  // Both or neither. A half cursor is a link somebody edited by hand, and
  // passing it on would be a refusal from the schema rather than a page.
  return at && id ? { at, id } : undefined;
}

const when = (at: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));

export default async function ActivityPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ at?: string; id?: string }>;
}) {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const params = await searchParams;
  const cursor = parseCursor(params.at, params.id);

  const [items, directory, settings] = await Promise.all([
    callAction(context, "activities.workspaceFeed", {
      ...(cursor ? { cursor } : {}),
    }),
    callAction(context, "people.directory", {}),
    callAction(context, "settings.readWorkspaceSettings", {}),
  ]);

  const names = new Map(directory.map((member) => [member.id, member.name]));
  const timeZone = String(settings.settings.timezone ?? "UTC");
  const last = items.at(-1);

  return (
    <div className="flex flex-col gap-4.5">
      {/* The workspace scope's live insert (P6-G11c). Not on a paged view:
          paging is a link, and refreshing a window the reader navigated
          back to would move the boundary they are reading across. */}
      {cursor ? null : <FeedLive scope="workspace" />}
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">
              {t("common.activity")}
            </h1>
            <p className="text-sm text-ink-3">
              {t("activity.whatHasHappenedHere")}{" "}
              <code>{t("activity.pnpmAuditVerify")}</code>.
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          {items.length === 0 ? (
            <p className="text-sm text-ink-3">
              {cursor
                ? "Nothing further back than this."
                : "Nothing yet. Every check-in, goal, session and setting change lands here as it happens."}
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
                      {when(item.at, timeZone)}
                    </span>
                  </span>
                  {item.aggregatedCount > 1 ? (
                    <Chip tone="neutral">
                      {item.aggregatedCount} {t("activity.editsTogether")}
                    </Chip>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3">
        {cursor ? (
          <Link
            href="/activity"
            className="text-xs font-semibold text-brand-text hover:underline"
          >
            {t("activity.backToTheNewest")}
          </Link>
        ) : (
          <span />
        )}
        {/* The cursor is the last row's own key, which is what makes paging
            stable while new rows arrive at the top (P2-T07). A page shorter
            than the action's own size is the end, so there is nothing to
            offer. */}
        {last && items.length > 1 ? (
          <Link
            href={`/activity?at=${encodeURIComponent(last.at)}&id=${last.id}`}
            className="text-xs font-semibold text-brand-text hover:underline"
          >
            {t("activity.older")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
